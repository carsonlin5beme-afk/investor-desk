import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAmbientGraph } from "@/lib/ambient-audio";
import {
  createJourneyScore,
  journey,
  journeyProcessorSource,
} from "@/lib/ambient-journey";

const effects = vi.hoisted(() => ({
  impact: { play: vi.fn(() => () => {}), cancel: vi.fn(), dispose: vi.fn() },
  launch: {
    play: vi.fn((_elapsed: number) => () => {}),
    cancel: vi.fn(),
    dispose: vi.fn(),
  },
  impactFactory: vi.fn(),
  launchFactory: vi.fn(),
}));
vi.mock("@/lib/asteroid-impact-audio", () => ({
  createAsteroidImpactPlayer: (...args: unknown[]) => {
    effects.impactFactory(...args);
    return effects.impact;
  },
}));
vi.mock("@/lib/blast-launch-audio", () => ({
  createBlastLaunchPlayer: (...args: unknown[]) => {
    effects.launchFactory(...args);
    return effects.launch;
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

type Processor = {
  position: number;
  loopFrames: number;
  chordFrames: number;
  chordIndex: number;
  process(inputs: unknown[], outputs: Float32Array[][]): boolean;
};
function processor(sampleRate: number) {
  const messages: {
    type?: string;
    positionFrames?: number;
    contextFrame?: number;
  }[] = [];
  let Factory!: new (options: object) => Processor;
  const environment = {
    sampleRate,
    currentFrame: 256,
    AudioWorkletProcessor: class {
      port = {
        onmessage: null,
        postMessage: (m: object) => messages.push(structuredClone(m)),
      };
    },
    registerProcessor: (_: string, constructor: typeof Factory) => {
      Factory = constructor;
    },
  };
  runInNewContext(journeyProcessorSource, environment);
  const instance = new Factory({
    processorOptions: { ...journey, notes: createJourneyScore() },
  });
  const render = (frames: number) => {
    instance.process(
      [],
      [[new Float32Array(frames), new Float32Array(frames)]],
    );
    environment.currentFrame += frames;
  };
  return { instance, messages, environment, render };
}

describe("journey render clock", () => {
  it.each([44100, 48000])(
    "pairs the first render, chord boundary and loop seam with audio frames at %i Hz",
    (rate) => {
      const p = processor(rate);
      p.render(257);
      expect(p.messages).toEqual([
        { type: "journey-clock", positionFrames: 0, contextFrame: 256 },
      ]);
      p.render(64);
      expect(p.messages).toHaveLength(1);
      p.instance.position = p.instance.chordFrames - 32;
      p.environment.currentFrame = rate * 40;
      p.render(65);
      expect(p.messages.at(-1)).toEqual({
        type: "journey-clock",
        positionFrames: p.instance.chordFrames,
        contextFrame: rate * 40 + 32,
      });
      p.instance.position = p.instance.loopFrames - 16;
      p.instance.chordIndex = 11;
      p.environment.currentFrame = rate * 190;
      p.render(33);
      expect(p.messages.at(-1)).toEqual({
        type: "journey-clock",
        positionFrames: 0,
        contextFrame: rate * 190 + 16,
      });
      expect(p.instance.position).toBe(17);
    },
  );
});

async function graphFixture() {
  const nodes: object[] = [];
  function makeNode() {
    const node = Object.assign(new EventTarget(), {
      connect: vi.fn((next: unknown) => next),
      disconnect: vi.fn(),
      port: {
        onmessage: null as ((event: MessageEvent) => void) | null,
        postMessage: vi.fn(),
        close: vi.fn(),
      },
    });
    nodes.push(node);
    return node;
  }
  let instrument!: ReturnType<typeof makeNode>;
  const context = {
    sampleRate: 8000,
    currentTime: 100,
    state: "running",
    destination: {},
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createGain: () =>
      Object.assign(makeNode(), {
        gain: {
          value: 0,
          cancelAndHoldAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
      }),
    createBiquadFilter: () =>
      Object.assign(makeNode(), {
        type: "",
        frequency: { value: 0 },
        Q: { value: 0 },
      }),
    createConvolver: () => Object.assign(makeNode(), { buffer: null }),
    createBuffer: (channels: number, frames: number) => {
      const data = Array.from(
        { length: channels },
        () => new Float32Array(frames),
      );
      return { getChannelData: (c: number) => data[c] };
    },
  };
  vi.stubGlobal("AudioWorkletNode", function () {
    instrument = makeNode();
    return instrument;
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:launch-clock");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const graph = await createAmbientGraph(
    context as unknown as BaseAudioContext,
  );
  const deliver = (data: unknown) =>
    instrument.port.onmessage?.({ data } as MessageEvent);
  return { graph, context, instrument, nodes, deliver };
}

describe("launch graph ownership and harmony clock", () => {
  it("uses the existing master, preserves independent impacts and ignores delivery delays and paused wall time", async () => {
    const f = await graphFixture();
    expect(effects.impactFactory.mock.calls[0]).toEqual(
      effects.launchFactory.mock.calls[0],
    );
    expect(effects.launchFactory.mock.calls[0][1]).toBe(f.nodes[0]);
    f.graph.playLaunch()();
    expect(effects.launch.play).not.toHaveBeenCalled();
    // An anchor rendered three seconds ago remains correct when received now.
    f.deliver({
      type: "journey-clock",
      positionFrames: 10 * 8000,
      contextFrame: 97 * 8000,
    });
    f.graph.playLaunch();
    expect(effects.launch.play).toHaveBeenLastCalledWith(13);
    f.context.state = "suspended";
    f.context.state = "running";
    f.graph.playLaunch();
    expect(effects.launch.play).toHaveBeenLastCalledWith(13);
    f.context.currentTime = 249;
    f.graph.playLaunch();
    expect(effects.launch.play).toHaveBeenLastCalledWith(2);
    f.graph.playImpact(true);
    f.graph.cancelLaunch();
    expect(effects.impact.cancel).not.toHaveBeenCalled();
    expect(effects.impact.play).toHaveBeenCalledWith(true);
    f.graph.cancelImpact();
    expect(effects.launch.cancel).toHaveBeenCalledOnce();
    f.graph.dispose();
    expect(effects.impact.dispose).toHaveBeenCalledOnce();
    expect(effects.launch.dispose).toHaveBeenCalledOnce();
  });

  it("rejects malformed, older, future and disposed anchors without assuming the first chord", async () => {
    const f = await graphFixture();
    for (const data of [
      null,
      {},
      { type: "stats", positionFrames: 0, contextFrame: 0 },
      { type: "journey-clock", positionFrames: NaN, contextFrame: 0 },
      { type: "journey-clock", positionFrames: 160 * 8000, contextFrame: 0 },
      { type: "journey-clock", positionFrames: 0, contextFrame: -1 },
    ])
      f.deliver(data);
    f.graph.playLaunch();
    expect(effects.launch.play).not.toHaveBeenCalled();
    f.deliver({
      type: "journey-clock",
      positionFrames: 0,
      contextFrame: 101 * 8000,
    });
    f.graph.playLaunch();
    expect(effects.launch.play).not.toHaveBeenCalled();
    f.context.currentTime = 102;
    f.deliver({
      type: "journey-clock",
      positionFrames: 120 * 8000,
      contextFrame: 99 * 8000,
    });
    f.graph.playLaunch();
    expect(effects.launch.play).toHaveBeenLastCalledWith(1);
    const oldHandler = f.instrument.port.onmessage!;
    f.graph.dispose();
    expect(f.instrument.port.onmessage).toBeNull();
    oldHandler({
      data: {
        type: "journey-clock",
        positionFrames: 0,
        contextFrame: 102 * 8000,
      },
    } as MessageEvent);
    f.graph.playLaunch();
    expect(effects.launch.play).toHaveBeenCalledOnce();
  });
});
