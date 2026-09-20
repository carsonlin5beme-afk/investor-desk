import { describe, expect, it, vi } from "vitest";
import { journey } from "@/lib/ambient-journey";
import {
  blastLaunchSeconds,
  createBlastLaunchPlayer,
  renderBlastLaunch,
  selectBlastLaunchChord,
  type BlastLaunchPcm,
} from "@/lib/blast-launch-audio";

const chordSeconds = journey.seconds / journey.chords.length;
const pitchClasses = (index: number) =>
  journey.chords[index].map((pitch) => pitch % 12);
function rms(pcm: BlastLaunchPcm, rate: number, from: number, to: number) {
  let sum = 0;
  const start = Math.round(from * rate),
    end = Math.round(to * rate);
  for (let i = start; i < end; i++) sum += pcm.left[i] ** 2 + pcm.right[i] ** 2;
  return Math.sqrt(sum / (2 * (end - start)));
}
// Measure the actual PCM, using a Hann window to reject neighboring tones.
function onsetAmplitude(
  pcm: BlastLaunchPcm,
  rate: number,
  hz: number,
  from = 0.012,
  to = 0.14,
) {
  const start = Math.round(rate * from),
    end = Math.round(rate * to);
  let real = 0,
    imaginary = 0,
    weights = 0;
  for (let frame = start; frame < end; frame++) {
    const weight =
      0.5 - 0.5 * Math.cos((2 * Math.PI * (frame - start)) / (end - start - 1));
    const value = ((pcm.left[frame] + pcm.right[frame]) / 2) * weight;
    const phase = (2 * Math.PI * hz * frame) / rate;
    real += value * Math.cos(phase);
    imaginary += value * Math.sin(phase);
    weights += weight;
  }
  return (2 * Math.hypot(real, imaginary)) / weights;
}
function audioMock() {
  const failure = { at: "" };
  const buffers: object[] = [];
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
    state: "running",
    currentTime: 12,
    resume: vi.fn(),
    createConvolver: vi.fn(),
    createBuffer: vi.fn((channels: number, frames: number) => {
      const data = Array.from(
        { length: channels },
        () => new Float32Array(frames),
      );
      const buffer = { getChannelData: (index: number) => data[index] };
      buffers.push(buffer);
      return buffer;
    }),
    createBufferSource: vi.fn(() => {
      if (failure.at === "source") throw new Error("source allocation");
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
        if (failure.at === "source-connect") throw new Error("source connect");
        source.connected = true;
      });
      source.disconnect.mockImplementation(() => {
        source.connected = false;
      });
      source.start.mockImplementation(() => {
        if (failure.at === "start") throw new Error("start");
      });
      sources.push(source);
      return source;
    }),
    createGain: vi.fn(() => {
      if (failure.at === "gain") throw new Error("gain allocation");
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
        if (failure.at === "gain-connect") throw new Error("gain connect");
        gain.connected = true;
      });
      gain.disconnect.mockImplementation(() => {
        gain.connected = false;
      });
      gains.push(gain);
      return gain;
    }),
  };
  const player = createBlastLaunchPlayer(
    context as unknown as BaseAudioContext,
    output,
  );
  return { player, context, buffers, sources, gains, failure, output };
}

describe("launch harmony selector", () => {
  it("tracks every chord, pad overlap, root and octave voicing without unrelated pitches", () => {
    const keys = new Set<string>();
    for (let chord = 0; chord < journey.chords.length; chord++) {
      for (const phase of [0, 1, 3.599, 3.601, 6, 10, 11, 13]) {
        const selection = selectBlastLaunchChord(chord * chordSeconds + phase);
        expect(selection.chordIndex).toBe(chord);
        expect(selection.phaseSeconds).toBeCloseTo(phase, 10);
        const overlap =
          phase < 3.6
            ? "previous"
            : phase + blastLaunchSeconds >= chordSeconds
              ? "next"
              : null;
        expect(selection.overlap).toBe(overlap);
        expect(pitchClasses(chord)).toContain(selection.pitchClass);
        expect(new Set(selection.pitches.map((pitch) => pitch % 12))).toEqual(
          new Set([selection.pitchClass]),
        );
        if (overlap) {
          const other = (chord + (overlap === "previous" ? 11 : 1)) % 12;
          expect(pitchClasses(other)).toContain(selection.pitchClass);
          expect(selection.overlapPitchClasses).toContain(selection.pitchClass);
          expect(
            selection.overlapPitchClasses.every(
              (pitch) =>
                pitchClasses(chord).includes(pitch) &&
                pitchClasses(other).includes(pitch),
            ),
          ).toBe(true);
        } else expect(selection.pitchClass).toBe(journey.chords[chord][0] % 12);
        keys.add(selection.key);
      }
    }
    expect([...keys].sort()).toEqual(["11", "2", "6", "7", "9"]);
  });

  it("remains consonant with every pad sounding throughout the full launch tail", () => {
    for (let launch = 0; launch < 160; launch += 0.29) {
      const selected = selectBlastLaunchChord(launch).pitchClass;
      for (let delta = 0; delta < blastLaunchSeconds; delta += 0.07) {
        const position = (launch + delta) % 160;
        const current = Math.min(11, Math.floor(position / chordSeconds));
        expect(pitchClasses(current)).toContain(selected);
        if (position - current * chordSeconds < 3.6)
          expect(pitchClasses((current + 11) % 12)).toContain(selected);
      }
    }
  });

  it("wraps precisely at the score loop and handles invalid elapsed times deterministically", () => {
    expect(selectBlastLaunchChord(160)).toEqual(selectBlastLaunchChord(0));
    expect(selectBlastLaunchChord(-1)).toEqual(selectBlastLaunchChord(159));
    for (const time of [NaN, Infinity, -Infinity])
      expect(selectBlastLaunchChord(time)).toEqual(selectBlastLaunchChord(0));
    for (let chord = 1; chord < 12; chord++) {
      expect(
        selectBlastLaunchChord(chord * chordSeconds - 0.000001).chordIndex,
      ).toBe(chord - 1);
      expect(
        selectBlastLaunchChord(chord * chordSeconds + 0.000001).chordIndex,
      ).toBe(chord);
    }
  });
});

describe("launch PCM", () => {
  it.each([44100, 48000, 96000])(
    "renders a finite, quiet, fading 2.8-second stereo sound at %i Hz",
    (rate) => {
      for (const elapsed of [0, 20, 33, 46, 92]) {
        const pcm = renderBlastLaunch(rate, elapsed);
        expect(pcm.left.length).toBe(Math.round(rate * 2.8));
        expect(pcm.right.length).toBe(pcm.left.length);
        let peak = 0,
          stereoDifference = 0;
        for (let i = 0; i < pcm.left.length; i++) {
          peak = Math.max(peak, Math.abs(pcm.left[i]), Math.abs(pcm.right[i]));
          stereoDifference += (pcm.left[i] - pcm.right[i]) ** 2;
        }
        expect(
          pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite),
        ).toBe(true);
        expect(peak).toBeGreaterThan(0.074);
        expect(peak).toBeLessThan(0.076);
        expect(stereoDifference).toBeGreaterThan(0.001);
        expect(pcm.left[0]).toBe(0);
        expect(pcm.right[0]).toBe(0);
        expect(
          pcm.left
            .slice(-Math.floor(rate * 0.004))
            .every((value) => value === 0),
        ).toBe(true);
        expect(
          pcm.right
            .slice(-Math.floor(rate * 0.004))
            .every((value) => value === 0),
        ).toBe(true);
        expect(rms(pcm, rate, 0, 0.25)).toBeGreaterThan(rms(pcm, rate, 1.5, 2));
        expect(rms(pcm, rate, 1.5, 2)).toBeGreaterThan(
          rms(pcm, rate, 2.5, 2.8) * 2,
        );
      }
    },
  );

  it("leads with the chord-safe 1–2 kHz cling and a quieter supporting octave", () => {
    const rate = 48000;
    for (const elapsed of [0, 20, 33, 46, 92]) {
      const pcm = renderBlastLaunch(rate, elapsed);
      const { pitchClass } = selectBlastLaunchChord(elapsed);
      const fundamental = 440 * 2 ** ((84 + pitchClass - 69) / 12);
      expect(fundamental).toBeGreaterThan(1000);
      expect(fundamental).toBeLessThan(2000);
      const lead = onsetAmplitude(pcm, rate, fundamental);
      const body = onsetAmplitude(pcm, rate, fundamental / 2);
      const foreignTone = onsetAmplitude(
        pcm,
        rate,
        fundamental * 2 ** (1 / 12),
      );
      expect(body).toBeGreaterThan(0.005);
      expect(lead).toBeGreaterThan(body * 4);
      expect(lead).toBeGreaterThan(foreignTone * 100);
      // A single pitched component carries most onset energy; air is incidental.
      expect(lead ** 2 / 2).toBeGreaterThan(
        rms(pcm, rate, 0.012, 0.14) ** 2 * 0.8,
      );
    }
  });

  it("strikes immediately with a smooth attack, then diffuses into a quieter stereo tail", () => {
    const rate = 48000;
    for (const elapsed of [0, 20, 33, 46, 92]) {
      const pcm = renderBlastLaunch(rate, elapsed);
      const attack = rms(pcm, rate, 0.006, 0.02);
      expect(attack).toBeGreaterThan(0.035);
      expect(rms(pcm, rate, 0, 0.001)).toBeLessThan(attack * 0.03);
      expect(attack).toBeGreaterThan(rms(pcm, rate, 1.5, 2) * 10);
      let initialPeak = 0,
        tailDifference = 0;
      for (let frame = 0; frame < Math.round(rate * 0.025); frame++)
        initialPeak = Math.max(
          initialPeak,
          Math.abs(pcm.left[frame]),
          Math.abs(pcm.right[frame]),
        );
      for (let frame = rate; frame < rate * 2; frame++)
        tailDifference += (pcm.left[frame] - pcm.right[frame]) ** 2;
      expect(initialPeak).toBeGreaterThan(0.065);
      expect(tailDifference / rate).toBeGreaterThan(0.000001);
    }
  });

  it.each([8000, 11025, 22050])(
    "keeps the upper glints finite and guarded at %i Hz",
    (rate) => {
      const pcm = renderBlastLaunch(rate, 20); // B6 lead, B7 glint: glint exceeds the 8 kHz guard.
      expect(
        pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite),
      ).toBe(true);
      const lead = onsetAmplitude(pcm, rate, 1975.533205024496);
      expect(lead).toBeGreaterThan(0.04);
      if (rate === 8000) {
        // The inaudible 5.4x glass partial must not fold into a false tone below Nyquist.
        const foldedPartial = 1975.533205024496 * 5.4 - rate;
        expect(onsetAmplitude(pcm, rate, foldedPartial)).toBeLessThan(
          lead * 0.01,
        );
        // B7 is below Nyquist but above the conservative .43-rate guard.
        expect(
          onsetAmplitude(pcm, rate, 1975.533205024496 * 2, 0.17, 0.25),
        ).toBeLessThan(lead * 0.005);
      }
    },
  );

  it("is reproducible for matching selected tones and rejects unsafe allocation sizes", () => {
    const a = renderBlastLaunch(48000, 0),
      b = renderBlastLaunch(48000, 160);
    expect(a.left.every((value, index) => value === b.left[index])).toBe(true);
    expect(a.right.every((value, index) => value === b.right[index])).toBe(
      true,
    );
    for (const rate of [NaN, Infinity, 0, -1, 7999, 48000.1, 192001])
      expect(() => renderBlastLaunch(rate, 0)).toThrow(RangeError);
  });
});

describe("launch player", () => {
  it("prepares only five cached variants, selects by score time and does no PCM work on play", () => {
    const { player, context, buffers, sources, gains, output } = audioMock();
    expect(context.createBuffer).toHaveBeenCalledTimes(5);
    expect(sources).toHaveLength(0);
    const exponentials = vi.spyOn(Math, "exp");
    const timer = vi.spyOn(globalThis, "setTimeout");
    try {
      player.play(0);
      const first = sources[0].buffer;
      player.play(160);
      expect(sources[1].buffer).toBe(first);
      player.play(33);
      expect(sources[2].buffer).not.toBe(first);
      expect(buffers).toContain(sources[2].buffer);
      expect(sources[2].connect).toHaveBeenCalledWith(gains[2]);
      expect(gains[2].connect).toHaveBeenCalledWith(output);
      expect(sources[2].start).toHaveBeenCalledWith(12);
      expect(exponentials).not.toHaveBeenCalled();
      expect(timer).not.toHaveBeenCalled();
      expect(context.createBuffer).toHaveBeenCalledTimes(5);
      expect(context.resume).not.toHaveBeenCalled();
      expect(context.createConvolver).not.toHaveBeenCalled();
    } finally {
      exponentials.mockRestore();
      timer.mockRestore();
      player.dispose();
    }
  });

  it("keeps old cancellation and ended callbacks scoped to their voice, and cleans natural ends", () => {
    const { player, sources, gains } = audioMock();
    const oldCancel = player.play(0),
      oldEnded = sources[0].onended!;
    player.play(20);
    oldCancel();
    oldCancel();
    oldEnded();
    expect(sources[1].stop).not.toHaveBeenCalled();
    expect(sources[0].connected || gains[0].connected).toBe(false);
    sources[1].onended!();
    expect(sources[1].connected || gains[1].connected).toBe(false);
    expect(sources[1].buffer).toBeNull();
    expect(sources[1].onended).toBeNull();
    player.dispose();
  });

  it("disconnects a cancelled fade if the context becomes suspended or interrupted", () => {
    for (const state of ["suspended", "interrupted"]) {
      const { player, context, sources, gains } = audioMock();
      const cancel = player.play(0);
      cancel();
      cancel();
      expect(sources[0].stop).toHaveBeenCalledExactlyOnceWith(12.008);
      expect(gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
        0,
        12.008,
      );
      context.state = state;
      player.cancel();
      expect(sources[0].connected || gains[0].connected).toBe(false);
      expect(sources[0].buffer).toBeNull();
      player.play(20)();
      expect(sources).toHaveLength(1);
      context.state = "running";
      player.play(20);
      cancel();
      expect(sources[1].stop).not.toHaveBeenCalled();
      player.dispose();
    }
  });

  it("bounds connected nodes during rapid replacement and releases everything on repeated disposal", () => {
    const { player, sources, gains, context } = audioMock();
    for (let i = 0; i < 100; i++) {
      const cancel = player.play(i * 1.6);
      if (i % 3 === 0) cancel();
      expect(sources.filter((source) => source.connected)).toHaveLength(1);
      expect(gains.filter((gain) => gain.connected)).toHaveLength(1);
    }
    player.dispose();
    player.dispose();
    expect(
      sources.every(
        (source) =>
          !source.connected &&
          source.buffer === null &&
          source.onended === null,
      ),
    ).toBe(true);
    expect(gains.every((gain) => !gain.connected)).toBe(true);
    const count = sources.length;
    player.play(0)();
    expect(sources).toHaveLength(count);
    expect(context.createBuffer).toHaveBeenCalledTimes(5);
  });

  it.each(["source", "gain", "source-connect", "gain-connect", "start"])(
    "cleans partial graphs after a %s failure and can play later",
    (stage) => {
      const { player, sources, gains, failure } = audioMock();
      failure.at = stage;
      expect(() => player.play(0)()).not.toThrow();
      expect(
        sources.every((source) => !source.connected && source.buffer === null),
      ).toBe(true);
      expect(gains.every((gain) => !gain.connected)).toBe(true);
      failure.at = "";
      player.play(0);
      expect(sources.filter((source) => source.connected)).toHaveLength(1);
      player.dispose();
    },
  );
});
