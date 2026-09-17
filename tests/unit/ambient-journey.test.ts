import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { createAmbientGraph } from "@/lib/ambient-audio";
import {
  createJourneyScore,
  journey,
  journeyProcessorSource,
} from "@/lib/ambient-journey";

it("authors a complete returning motif and distinct high stars within the declared form", () => {
  const score = createJourneyScore();
  expect((journey.beats * 60) / journey.bpm).toBe(160);
  expect(journey.sections).toHaveLength(6);
  const wood = score.filter((n) => n.kind === "wood");
  let returns = 0;
  for (let i = 0; i <= wood.length - 5; i++) {
    if (wood.slice(i, i + 5).every((n, j) => n.note === journey.motif[j]))
      returns++;
  }
  expect(returns).toBeGreaterThanOrEqual(5);
  expect(
    score.filter((n) => n.kind === "star" && n.note >= 86 && n.note <= 95)
      .length,
  ).toBeGreaterThanOrEqual(14);
  expect(new Set(score.map((n) => n.kind))).toEqual(
    new Set(["wood", "star", "glass", "pulse"]),
  );
  expect(score.some((n) => n.beat >= 92 && n.beat < 96)).toBe(false);
  expect(score.some((n) => n.kind === "pulse" && n.beat >= 160)).toBe(false);
});

it("keeps all timed tails in a bounded voice pool across repeated score cycles", () => {
  const events: Array<{ time: number; change: number }> = [];
  const score = createJourneyScore();
  expect(score).toEqual(createJourneyScore());
  for (let cycle = 0; cycle < 3; cycle++)
    for (const note of score) {
      expect(
        [note.beat, note.note, note.gain, note.duration, note.pan].every(
          Number.isFinite,
        ),
      ).toBe(true);
      expect(note.beat).toBeGreaterThanOrEqual(0);
      expect(note.beat).toBeLessThan(journey.beats);
      expect(note.gain).toBeGreaterThan(0);
      expect(note.gain).toBeLessThan(0.1);
      expect(Math.abs(note.pan)).toBeLessThan(1);
      const start = cycle * journey.seconds + (note.beat * 60) / journey.bpm;
      events.push(
        { time: start, change: 1 },
        { time: start + note.duration, change: -1 },
      );
    }
  events.sort((a, b) => a.time - b.time || a.change - b.change);
  let active = 0,
    peak = 0;
  for (const event of events) {
    active += event.change;
    peak = Math.max(peak, active);
  }
  expect(active).toBe(0);
  expect(peak).toBeLessThan(journey.voiceLimit);
});

type Processor = {
  position: number;
  loopFrames: number;
  loops: number;
  chordIndex: number;
  intro: number;
  fade: number;
  padPhases: Float64Array;
  padFrequency: Float64Array;
  voices: object[];
  port: { onmessage: (event: { data: string }) => void };
  process(inputs: unknown[], outputs: Float32Array[][]): boolean;
};
const processor = () => {
  let Factory!: new (options: object) => Processor;
  runInNewContext(journeyProcessorSource, {
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      port = { onmessage: null, postMessage() {} };
    },
    registerProcessor: (_name: string, constructor: typeof Factory) => {
      Factory = constructor;
    },
  });
  return new Factory({
    processorOptions: { ...journey, notes: createJourneyScore() },
  });
};

it("handles actual block lengths, carries pad phases across the seam and retires on stop", () => {
  const p = processor();
  const voices = [...p.voices];
  p.position = p.loopFrames - 64;
  p.chordIndex = 11;
  p.intro = p.fade = 1;
  const phases = [...p.padPhases];
  const block = [new Float32Array(128), new Float32Array(128)];
  expect(p.process([], [block])).toBe(true);
  expect(p.loops).toBe(1);
  expect(p.position).toBe(64);
  for (let i = 0; i < 8; i++)
    expect(p.padPhases[i * 2]).toBeCloseTo(
      (phases[i * 2] + (128 * p.padFrequency[i]) / 48000) % 1,
      10,
    );
  for (const size of [64, 257]) {
    const next = [new Float32Array(size), new Float32Array(size)];
    expect(p.process([], [next])).toBe(true);
    expect(next.every((channel) => channel.every(Number.isFinite))).toBe(true);
    expect(next.some((channel) => channel.some((sample) => sample !== 0))).toBe(
      true,
    );
  }
  expect(p.voices.every((voice, index) => voice === voices[index])).toBe(true);
  p.port.onmessage({ data: "stop" });
  expect(p.process([], [block])).toBe(false);
});

it.each([44100, 48000, 96000])(
  "matches a %i Hz convolver and releases its buffers",
  async (sampleRate) => {
    const nodes: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
    const makeNode = () => {
      const node = Object.assign(new EventTarget(), {
        connect: (next: unknown) => next,
        disconnect: vi.fn(),
        port: { postMessage: vi.fn(), close: vi.fn() },
      });
      nodes.push(node);
      return node;
    };
    let room: AudioBuffer | null = null;
    const context = {
      sampleRate,
      destination: {},
      currentTime: 0,
      audioWorklet: { addModule: vi.fn(async () => {}) },
      createGain: () =>
        Object.assign(makeNode(), {
          gain: {
            value: 0,
            cancelAndHoldAtTime() {},
            linearRampToValueAtTime() {},
          },
        }),
      createBiquadFilter: () =>
        Object.assign(makeNode(), {
          type: "",
          frequency: { value: 0 },
          Q: { value: 0 },
        }),
      createConvolver: () =>
        Object.defineProperty(makeNode(), "buffer", {
          get: () => room,
          set: (buffer: AudioBuffer | null) => {
            if (buffer && buffer.sampleRate !== sampleRate)
              throw new Error("Convolver sample-rate mismatch");
            room = buffer;
          },
        }),
      createBuffer: (channels: number, length: number, rate: number) => {
        const data = Array.from(
          { length: channels },
          () => new Float32Array(length),
        );
        return {
          sampleRate: rate,
          length,
          numberOfChannels: channels,
          getChannelData: (channel: number) => data[channel],
        };
      },
    };
    vi.stubGlobal("AudioWorkletNode", function () {
      return makeNode();
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-audio-test");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    try {
      const graph = await createAmbientGraph(
        context as unknown as BaseAudioContext,
      );
      const buffer = room as AudioBuffer | null;
      expect(buffer?.sampleRate).toBe(sampleRate);
      expect(buffer?.length).toBe(sampleRate * 4);
      expect(buffer?.numberOfChannels).toBe(2);
      expect(buffer!.getChannelData(0).every(Number.isFinite)).toBe(true);
      expect(revoke).toHaveBeenCalledWith("blob:local-audio-test");
      graph.dispose();
      graph.dispose();
      expect(room).toBeNull();
      expect(
        nodes.every((node) => node.disconnect.mock.calls.length === 1),
      ).toBe(true);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  },
);
