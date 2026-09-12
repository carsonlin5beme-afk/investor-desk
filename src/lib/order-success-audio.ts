/** Original, quiet cash-register cue. No samples, streams, or remote assets. */
export function createOrderChime(context: BaseAudioContext): () => void {
  const output = context.createGain();
  output.gain.value = 0.2;
  output.connect(context.destination);
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [output];
  const now = context.currentTime;
  for (const [offset, frequency, gain] of [
    [0, 880, 0.3],
    [0, 1320, 0.09],
    [0.105, 1174.66, 0.28],
    [0.105, 1760, 0.085],
  ]) {
    const tone = context.createOscillator();
    const envelope = context.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency;
    envelope.gain.setValueAtTime(0, now + offset);
    envelope.gain.linearRampToValueAtTime(gain, now + offset + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.32);
    envelope.gain.linearRampToValueAtTime(0, now + offset + 0.35);
    tone.connect(envelope).connect(output);
    tone.start(now + offset);
    tone.stop(now + offset + 0.36);
    sources.push(tone);
    nodes.push(tone, envelope);
  }
  const noise = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * 0.025),
    context.sampleRate,
  );
  const samples = noise.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    samples[i] =
      (seed / 2147483648 - 1) *
      0.07 *
      Math.sin((Math.PI * i) / samples.length) ** 2;
  }
  const coin = context.createBufferSource();
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2200;
  coin.buffer = noise;
  coin.connect(filter).connect(output);
  coin.start(now);
  sources.push(coin);
  nodes.push(coin, filter);
  return () => {
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
    }
    for (const node of nodes) node.disconnect();
    coin.buffer = null;
  };
}

type AudioDependencies = {
  context: () => AudioContext;
  chime: (context: AudioContext) => () => void;
};

/** A confirmation gesture arms silent audio; only a new successful order can sound it. */
export class OrderSuccessAudio {
  private context: AudioContext | null = null;
  private ready: Promise<boolean> = Promise.resolve(false);
  private attempt = 0;
  private muted = false;
  private disposed = false;
  private armed = false;
  private stopChime: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly sounded = new Map<string, number>();
  constructor(
    private readonly dependencies: AudioDependencies = {
      context: () => new AudioContext(),
      chime: createOrderChime,
    },
  ) {}

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.cancel();
  }
  prepare(): number {
    this.clear();
    const attempt = ++this.attempt;
    if (this.muted || this.disposed) return attempt;
    this.armed = true;
    try {
      this.context ??= this.dependencies.context();
      const context = this.context;
      // Resume is invoked before the caller awaits HTTP, preserving the user gesture.
      this.ready = context
        .resume()
        .then(() => {
          if (!this.armed && context.state === "running")
            void context.suspend().catch(() => {});
          return context.state === "running";
        })
        .catch(() => false);
      this.timer = setTimeout(() => this.cancel(attempt), 60000);
    } catch {
      this.ready = Promise.resolve(false);
    }
    return attempt;
  }
  success(attempt: number, orderId: string, replayed: boolean) {
    if (this.sounded.has(orderId)) {
      if (this.sounded.get(orderId) !== attempt) this.cancel(attempt);
      return;
    }
    if (replayed || !orderId) {
      this.cancel(attempt);
      return;
    }
    if (attempt !== this.attempt || this.muted || this.disposed) return;
    this.sounded.set(orderId, attempt);
    if (this.sounded.size > 128)
      this.sounded.delete(this.sounded.keys().next().value!);
    void this.ready.then((ready) => {
      if (
        !ready ||
        attempt !== this.attempt ||
        this.muted ||
        this.disposed ||
        this.context?.state !== "running"
      )
        return;
      try {
        this.clear();
        this.stopChime = this.dependencies.chime(this.context);
        this.timer = setTimeout(() => this.cancel(attempt), 650);
      } catch {
        this.cancel(attempt);
      }
    });
  }
  cancel(attempt?: number) {
    if (attempt !== undefined && attempt !== this.attempt) return;
    this.attempt++;
    this.armed = false;
    this.clear();
    try {
      if (this.context?.state === "running")
        void this.context.suspend().catch(() => {});
    } catch {
      /* Audio cannot fail an order. */
    }
  }
  dispose() {
    this.disposed = true;
    this.cancel();
    try {
      if (this.context) void this.context.close().catch(() => {});
    } catch {
      /* Already unavailable. */
    }
    this.context = null;
  }
  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const stop = this.stopChime;
    this.stopChime = null;
    try {
      stop?.();
    } catch {
      /* Audio cleanup cannot fail an order. */
    }
  }
}
