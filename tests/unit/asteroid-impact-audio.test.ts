import { describe, expect, it, vi } from "vitest";
import {
  createAsteroidImpactPlayer,
  renderAsteroidImpact,
  type AsteroidImpactPcm,
} from "@/lib/asteroid-impact-audio";

function measure(pcm: AsteroidImpactPcm, sampleRate: number, from = 0, to = 5) {
  let peak = 0,
    energy = 0,
    difference = 0,
    derivative = 0;
  const start = Math.round(from * sampleRate),
    end = Math.round(to * sampleRate);
  for (let frame = start; frame < end; frame++) {
    const l = pcm.left[frame],
      r = pcm.right[frame];
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    energy += l * l + r * r;
    difference += (l - r) ** 2;
    if (frame > start)
      derivative +=
        (l - pcm.left[frame - 1]) ** 2 + (r - pcm.right[frame - 1]) ** 2;
  }
  return {
    peak,
    energy,
    rms: Math.sqrt(energy / (2 * (end - start))),
    difference,
    brightness: derivative / energy,
  };
}

function audioMock() {
  const buffers: { getChannelData(channel: number): Float32Array }[] = [];
  const sources: {
    buffer: unknown;
    connected: boolean;
    onended: (() => void) | null;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  const gains: {
    connected: boolean;
    gain: {
      value: number;
      setValueAtTime: ReturnType<typeof vi.fn>;
      cancelScheduledValues: ReturnType<typeof vi.fn>;
      linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const output = {} as AudioNode;
  const context = {
    sampleRate: 8000,
    currentTime: 12,
    state: "running",
    resume: vi.fn(),
    createConvolver: vi.fn(),
    createBuffer: vi.fn((channels: number, frames: number) => {
      const data = Array.from(
        { length: channels },
        () => new Float32Array(frames),
      );
      const buffer = { getChannelData: (channel: number) => data[channel] };
      buffers.push(buffer);
      return buffer;
    }),
    createBufferSource: vi.fn(() => {
      const source = {
        buffer: null as unknown,
        connected: false,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      source.connect.mockImplementation(() => {
        source.connected = true;
      });
      source.disconnect.mockImplementation(() => {
        source.connected = false;
      });
      sources.push(source);
      return source;
    }),
    createGain: vi.fn(() => {
      const gain = {
        connected: false,
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          cancelScheduledValues: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gain.connect.mockImplementation(() => {
        gain.connected = true;
      });
      gain.disconnect.mockImplementation(() => {
        gain.connected = false;
      });
      gains.push(gain);
      return gain;
    }),
  };
  const player = createAsteroidImpactPlayer(
    context as unknown as BaseAudioContext,
    output,
  );
  return { context, output, buffers, sources, gains, player };
}

describe("asteroid impact PCM", () => {
  it.each([8000, 44100, 48000, 96000, 192000])(
    "renders exactly five finite, headroom-safe stereo seconds at %i Hz",
    (sampleRate) => {
      for (const gold of [false, true]) {
        const pcm = renderAsteroidImpact(sampleRate, gold);
        expect(pcm.left.length).toBe(sampleRate * 5);
        expect(pcm.right.length).toBe(sampleRate * 5);
        expect(
          pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite),
        ).toBe(true);
        expect(pcm.left[0]).toBe(0);
        expect(pcm.right[0]).toBe(0);
        expect(
          pcm.left
            .slice(-Math.floor(sampleRate * 0.004))
            .every((value) => value === 0),
        ).toBe(true);
        expect(
          pcm.right
            .slice(-Math.floor(sampleRate * 0.004))
            .every((value) => value === 0),
        ).toBe(true);
        const full = measure(pcm, sampleRate);
        expect(full.peak).toBeLessThanOrEqual(gold ? 0.400001 : 0.290001);
        expect(full.peak).toBeCloseTo(gold ? 0.4 : 0.29, 6);
        expect(full.difference).toBeGreaterThan(full.energy * 0.01);
        expect(measure(pcm, sampleRate, 0, 0.001).peak).toBeLessThan(
          full.peak * 0.15,
        );
        expect(measure(pcm, sampleRate, 0, 0.25).rms).toBeGreaterThan(
          measure(pcm, sampleRate, 1, 2).rms * 3,
        );
        expect(measure(pcm, sampleRate, 1, 2).rms).toBeGreaterThan(
          measure(pcm, sampleRate, 4.5, 5).rms * 3,
        );
        // A developing pitched tail remains audible after the initial fracture.
        expect(measure(pcm, sampleRate, 2.5, 4.3).rms).toBeGreaterThan(
          measure(pcm, sampleRate, 0, 0.25).rms * 0.03,
        );
        expect(measure(pcm, sampleRate, 4.9, 5).rms).toBeLessThan(
          measure(pcm, sampleRate, 4, 4.3).rms * 0.025,
        );
      }
    },
  );

  it("has a stronger, brighter gold signature rather than a louder copy and renders reproducibly", () => {
    const normal = renderAsteroidImpact(48000, false),
      gold = renderAsteroidImpact(48000, true);
    const a = measure(normal, 48000),
      b = measure(gold, 48000);
    expect(b.energy).toBeGreaterThan(a.energy * 1.5);
    // Assess the pitched glimmer after the noisy impact, not the air burst's spectrum.
    expect(measure(gold, 48000, 1, 4).brightness).toBeGreaterThan(
      measure(normal, 48000, 1, 4).brightness * 1.5,
    );
    expect(measure(gold, 48000, 2.5, 4.3).energy).toBeGreaterThan(
      measure(normal, 48000, 2.5, 4.3).energy * 3,
    );
    for (const [variant, pcm] of [
      [false, normal],
      [true, gold],
    ] as const) {
      const repeated = renderAsteroidImpact(48000, variant);
      expect(
        pcm.left.every((value, index) => value === repeated.left[index]),
      ).toBe(true);
      expect(
        pcm.right.every((value, index) => value === repeated.right[index]),
      ).toBe(true);
    }
  });

  it("develops distinct crystalline gold detail without a broadband treble wall", () => {
    const sampleRate = 48000;
    const bandEnergy = (pcm: AsteroidImpactPcm, cutoff: number) => {
      const coefficient = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
      let l = 0,
        r = 0,
        high = 0,
        total = 0;
      for (let frame = sampleRate; frame < sampleRate * 4; frame++) {
        const a = pcm.left[frame],
          b = pcm.right[frame];
        l += coefficient * (a - l);
        r += coefficient * (b - r);
        high += (a - l) ** 2 + (b - r) ** 2;
        total += a * a + b * b;
      }
      return high / total;
    };
    const normal = renderAsteroidImpact(sampleRate, false);
    const gold = renderAsteroidImpact(sampleRate, true);
    expect(bandEnergy(gold, 1200)).toBeGreaterThan(
      bandEnergy(normal, 1200) * 1.4,
    );
    for (const pcm of [normal, gold]) {
      expect(bandEnergy(pcm, 6000)).toBeLessThan(0.025);
      // Independent stereo reflections and moving notes change the late spatial field.
      const early = measure(pcm, sampleRate, 0.25, 0.75);
      const tail = measure(pcm, sampleRate, 2.5, 4.3);
      expect(
        Math.abs(
          early.difference / early.energy - tail.difference / tail.energy,
        ),
      ).toBeGreaterThan(0.02);
    }
  });

  it("rejects invalid or unbounded allocations", () => {
    for (const rate of [NaN, Infinity, -1, 0, 48000.5, 1000, 1000000])
      expect(() => renderAsteroidImpact(rate, false)).toThrow(RangeError);
  });
});

describe("asteroid impact player", () => {
  it("caches two buffers during preparation and routes each bounded voice directly to the existing output", () => {
    const { player, context, output, sources, gains, buffers } = audioMock();
    expect(context.createBuffer).toHaveBeenCalledTimes(2);
    expect(sources).toHaveLength(0);
    player.play(false);
    expect(sources[0].buffer).toBe(buffers[0]);
    expect(sources[0].connect).toHaveBeenCalledWith(gains[0]);
    expect(gains[0].connect).toHaveBeenCalledWith(output);
    expect(sources[0].start).toHaveBeenCalledWith(12);
    player.play(true);
    expect(sources[1].buffer).toBe(buffers[1]);
    expect(context.createBuffer).toHaveBeenCalledTimes(2);
    expect(context.resume).not.toHaveBeenCalled();
    expect(context.createConvolver).not.toHaveBeenCalled();
    player.dispose();
  });

  it("replaces old voices without allowing stale cancellation or ended callbacks to stop the newest voice", () => {
    const { player, sources, gains } = audioMock();
    const firstCancel = player.play(false);
    const oldEnded = sources[0].onended!;
    const secondCancel = player.play(true);
    expect(sources[0].stop).toHaveBeenCalledOnce();
    expect(sources[0].connected).toBe(false);
    expect(gains[0].connected).toBe(false);
    firstCancel();
    firstCancel();
    oldEnded();
    expect(sources[1].stop).not.toHaveBeenCalled();
    expect(sources[1].connected).toBe(true);
    secondCancel();
    secondCancel();
    player.cancel();
    expect(sources[1].stop).toHaveBeenCalledExactlyOnceWith(12.008);
    expect(gains[1].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0,
      12.008,
    );
    sources[1].onended!();
    expect(sources[1].connected).toBe(false);
    expect(gains[1].connected).toBe(false);
    expect(sources[1].buffer).toBeNull();
    player.dispose();
  });

  it("never accumulates retired connected nodes even with repeated cancellation and replacement", () => {
    const { player, sources, gains } = audioMock();
    for (let iteration = 0; iteration < 100; iteration++) {
      const cancel = player.play(iteration % 2 === 0);
      if (iteration % 3 === 0) cancel();
      expect(sources.filter((source) => source.connected)).toHaveLength(1);
      expect(gains.filter((gain) => gain.connected)).toHaveLength(1);
    }
    player.dispose();
    player.dispose();
    expect(sources.filter((source) => source.connected)).toHaveLength(0);
    expect(gains.filter((gain) => gain.connected)).toHaveLength(0);
    expect(
      sources.every(
        (source) => source.buffer === null && source.onended === null,
      ),
    ).toBe(true);
    const count = sources.length;
    player.play(true)();
    expect(sources).toHaveLength(count);
  });

  it("disconnects on natural end without timers and rejects suspended, closed or disposed playback", () => {
    const { player, context, sources, gains } = audioMock();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");
    try {
      player.play(false);
      sources[0].onended!();
      expect(sources[0].stop).not.toHaveBeenCalled();
      expect(sources[0].connected || gains[0].connected).toBe(false);
      context.state = "suspended";
      player.play(false)();
      context.state = "closed";
      player.play(true)();
      expect(sources).toHaveLength(1);
      player.dispose();
      context.state = "running";
      player.play(false)();
      expect(sources).toHaveLength(1);
      expect(timer).not.toHaveBeenCalled();
      expect(interval).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
      interval.mockRestore();
    }
  });

  it("cleans immediately when suspended so resuming cannot resurrect a cancelled voice", () => {
    const { player, context, sources, gains } = audioMock();
    const cancel = player.play(false);
    context.state = "suspended";
    cancel();
    expect(sources[0].stop).toHaveBeenCalledOnce();
    expect(sources[0].connected || gains[0].connected).toBe(false);
    expect(sources[0].onended).toBeNull();
    expect(sources[0].buffer).toBeNull();
    context.state = "running";
    cancel();
    expect(sources).toHaveLength(1);
    player.dispose();
  });

  it("cleans an interrupted fade immediately and leaves a later resumed voice independent", () => {
    const { player, context, sources, gains } = audioMock();
    const oldCancel = player.play(false);
    oldCancel();
    expect(sources[0].stop).toHaveBeenCalledWith(12.008);
    context.state = "suspended";
    player.cancel();
    expect(sources[0].stop).toHaveBeenCalledTimes(2);
    expect(sources[0].connected || gains[0].connected).toBe(false);
    expect(sources[0].buffer).toBeNull();
    expect(sources[0].onended).toBeNull();
    context.state = "running";
    player.play(true);
    oldCancel();
    expect(sources[1].stop).not.toHaveBeenCalled();
    expect(sources[1].connected).toBe(true);
    player.dispose();
  });
});
