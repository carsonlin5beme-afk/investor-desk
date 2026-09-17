import {
  createJourneyScore,
  journey,
  journeyProcessorSource,
} from "./ambient-journey";

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

const modules = new WeakMap<BaseAudioContext, Promise<void>>();

async function loadJourneyProcessor(context: BaseAudioContext) {
  let pending = modules.get(context);
  if (!pending) {
    if (!context.audioWorklet || typeof AudioWorkletNode !== "function")
      throw new Error("Audio worklets unavailable");
    const url = URL.createObjectURL(
      new Blob([journeyProcessorSource], { type: "text/javascript" }),
    );
    pending = context.audioWorklet
      .addModule(url)
      .finally(() => URL.revokeObjectURL(url));
    modules.set(context, pending);
    pending.catch(() => {
      if (modules.get(context) === pending) modules.delete(context);
    });
  }
  await pending;
}

/** One bounded, original score on the audio thread; no note timers or song PCM. */
export async function createAmbientGraph(
  context: BaseAudioContext,
  onError: () => void = () => {},
) {
  await loadJourneyProcessor(context);
  const nodes: AudioNode[] = [];
  const keep = <T extends AudioNode>(node: T): T => {
    nodes.push(node);
    return node;
  };
  let instrument: AudioWorkletNode | null = null;
  let reverb: ConvolverNode | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    instrument?.removeEventListener("processorerror", onError);
    instrument?.port.postMessage("stop");
    instrument?.port.close();
    for (const node of nodes) node.disconnect();
    if (reverb) reverb.buffer = null;
  };
  try {
    const master = keep(context.createGain());
    master.gain.value = 0;
    master.connect(context.destination);
    instrument = keep(
      new AudioWorkletNode(context, "investor-desk-long-way-home-v1", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { ...journey, notes: createJourneyScore() },
      }),
    );
    instrument.addEventListener("processorerror", onError);
    const lowCut = keep(context.createBiquadFilter());
    lowCut.type = "highpass";
    lowCut.frequency.value = 35;
    lowCut.Q.value = 0.5;
    const soften = keep(context.createBiquadFilter());
    soften.type = "lowpass";
    soften.frequency.value = 5200;
    soften.Q.value = 0.5;
    instrument.connect(lowCut).connect(soften);
    const dry = keep(context.createGain());
    dry.gain.value = 0.82;
    soften.connect(dry).connect(master);
    reverb = keep(context.createConvolver());
    // Preserve the authored 24 kHz room while matching ConvolverNode's required
    // context rate. Retained PCM is 1.46 MiB at 48 kHz (2.93 MiB at 96 kHz).
    const roomRate = 24000;
    const room = new Float32Array(roomRate * 4);
    const impulse = context.createBuffer(
      2,
      Math.round(context.sampleRate * 4),
      context.sampleRate,
    );
    let seed = 18731;
    for (let channel = 0; channel < 2; channel++) {
      let smooth = 0;
      for (let i = 0; i < room.length; i++) {
        seed = (seed * 16807) % 2147483647;
        smooth = smooth * 0.84 + ((seed / 2147483647) * 2 - 1) * 0.16;
        const attack = Math.min(1, i / (roomRate * 0.012));
        room[i] = smooth * attack * Math.pow(1 - i / room.length, 2.8);
      }
      const samples = impulse.getChannelData(channel);
      if (context.sampleRate === roomRate) samples.set(room);
      else
        for (let i = 0; i < samples.length; i++) {
          const position = (i * roomRate) / context.sampleRate;
          const index = Math.floor(position);
          const next = index + 1 < room.length ? room[index + 1] : 0;
          samples[i] = room[index] + (next - room[index]) * (position - index);
        }
    }
    reverb.buffer = impulse;
    const wet = keep(context.createGain());
    wet.gain.value = 0.36;
    soften.connect(reverb).connect(wet).connect(master);
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
        master.gain.linearRampToValueAtTime(
          boundedVolume(value),
          now + seconds,
        );
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

type AmbientGraph = Awaited<ReturnType<typeof createAmbientGraph>>;
type EngineDependencies = {
  context: () => AudioContext;
  graph: (
    context: BaseAudioContext,
    onError: () => void,
  ) => AmbientGraph | Promise<AmbientGraph>;
};

/** Owns one lazily created context. Audio time handles the sound; timers only finish fades. */
export class AmbientAudio {
  private context: AudioContext | null = null;
  private graph: AmbientGraph | null = null;
  private graphTask: Promise<AmbientGraph> | null = null;
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
      // Background listening favors a stable playback buffer over instrument latency.
      context: () => new AudioContext({ latencyHint: "playback" }),
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

  private prepareGraph(context: AudioContext) {
    if (this.graph) return Promise.resolve(this.graph);
    if (this.graphTask) return this.graphTask;
    const task = Promise.resolve()
      .then(() =>
        this.dependencies.graph(context, () => {
          if (this.disposed || this.context !== context) return;
          this.desired = false;
          this.operation++;
          this.clearTimers();
          this.release();
          this.update("error");
        }),
      )
      .then((graph) => {
        if (this.disposed || this.context !== context) {
          graph.dispose();
          throw new DOMException("Aborted", "AbortError");
        }
        this.graph = graph;
        return graph;
      })
      .finally(() => {
        if (this.graphTask === task) this.graphTask = null;
      });
    this.graphTask = task;
    return task;
  }

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
      await Promise.all([resumed, this.prepareGraph(context)]);
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
      this.graph!.fadeVolume(this.volume, 1.6);
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
    this.graphTask = null;
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
