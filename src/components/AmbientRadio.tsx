"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, Orbit, Volume2, X } from "lucide-react";
import {
  AmbientAudio,
  initialAmbientVolume,
  type AmbientState,
} from "@/lib/ambient-audio";
import styles from "./AmbientRadio.module.css";

const active = (state: AmbientState) =>
  state === "playing" || state === "starting";
const stateLabel: Record<AmbientState, string> = {
  idle: "Sound off",
  starting: "Starting…",
  playing: "Playing",
  pausing: "Fading out…",
  paused: "Paused",
  suspended: "Tap to resume",
  error: "Playback unavailable",
};
const RadioContext = createContext<{
  state: AmbientState;
  volume: number;
  motionVisible: boolean;
  toggle: () => void;
  changeVolume: (value: number) => void;
} | null>(null);

export function AmbientRadio({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AmbientState>("idle");
  const [volume, setVolume] = useState(initialAmbientVolume);
  const [motionVisible, setMotionVisible] = useState(false);
  const engine = useRef<AmbientAudio | null>(null);
  const volumeRef = useRef(initialAmbientVolume);
  const stateRef = useRef<AmbientState>("idle");
  const updateState = useCallback((next: AmbientState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const toggle = useCallback(() => {
    if (active(stateRef.current)) {
      engine.current?.pause();
      return;
    }
    engine.current ??= new AmbientAudio(updateState);
    engine.current.setVolume(volumeRef.current);
    void engine.current.play();
  }, [updateState]);
  const changeVolume = useCallback((value: number) => {
    const next = Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : initialAmbientVolume;
    volumeRef.current = next;
    setVolume(next);
    engine.current?.setVolume(next);
    try {
      localStorage.setItem("investor-desk:ambient-volume:v1", String(next));
    } catch {
      /* Volume still works. */
    }
  }, []);
  useEffect(() => {
    const visibility = () =>
      setMotionVisible(document.visibilityState === "visible");
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    // Fast Refresh retains React state/refs while rerunning effect cleanup.
    // A disposed engine must not leave a stuck Playing label or auto-resume.
    if (!engine.current && stateRef.current !== "idle") updateState("paused");
    try {
      const stored = localStorage.getItem("investor-desk:ambient-volume:v1");
      const value = stored === null ? NaN : Number(stored);
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        volumeRef.current = value;
        setVolume(value);
      }
    } catch {
      /* Restricted storage does not prevent listening. */
    }
    const leave = () => {
      engine.current?.dispose();
      engine.current = null;
      if (stateRef.current !== "idle") updateState("paused");
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      engine.current?.dispose();
      engine.current = null;
    };
  }, [updateState]);
  return (
    <RadioContext.Provider
      value={{ state, volume, motionVisible, toggle, changeVolume }}
    >
      {children}
    </RadioContext.Provider>
  );
}

/** Decorative playback identity; the provider remains the only audio owner. */
function RadioOrbit() {
  const radio = useContext(RadioContext);
  return (
    <span
      className={styles.orbit}
      aria-hidden="true"
      data-radio-orbit
      data-playing={radio?.state === "playing"}
      data-motion-visible={radio?.motionVisible ?? false}
    >
      <span className={styles.orbitBody}>
        <svg className={styles.orbitDisc} viewBox="0 0 64 64" focusable="false">
          <g className={`${styles.orbitPlane} ${styles.orbitPlaneOuter}`}>
            <ellipse
              className={styles.orbitTrack}
              cx="32"
              cy="32"
              rx="29"
              ry="17"
            />
            <ellipse
              className={`${styles.orbitFlow} ${styles.orbitOuter}`}
              cx="32"
              cy="32"
              rx="29"
              ry="17"
              pathLength="100"
            />
          </g>
          <g className={`${styles.orbitPlane} ${styles.orbitPlaneInner}`}>
            <ellipse
              className={styles.orbitTrack}
              cx="32"
              cy="32"
              rx="21"
              ry="12.3"
            />
            <ellipse
              className={`${styles.orbitFlow} ${styles.orbitInner}`}
              cx="32"
              cy="32"
              rx="21"
              ry="12.3"
              pathLength="100"
            />
          </g>
        </svg>
        <span className={styles.orbitDot} />
      </span>
    </span>
  );
}

export function DialogRadioControl() {
  const radio = useContext(RadioContext);
  if (!radio || radio.state === "idle") return null;
  const playing = active(radio.state);
  return (
    <button
      type="button"
      className={`icon-button ${styles.dialogControl}`}
      onClick={radio.toggle}
      aria-label={playing ? "Pause space radio" : "Resume space radio"}
      title={playing ? "Pause space radio" : "Resume space radio"}
    >
      <RadioOrbit />
    </button>
  );
}

/** The homepage's quiet inlet; it shares the same player as the full controls. */
export function AmbientRadioOrb() {
  const radio = useContext(RadioContext);
  if (!radio) return null;
  const playing = active(radio.state);
  const label = playing ? "Pause space radio" : "Play space radio";
  return (
    <div
      className={styles.orbDock}
      data-ambient-radio="orb"
      data-state={radio.state}
    >
      <button
        type="button"
        className={styles.orbButton}
        onClick={radio.toggle}
        aria-label={label}
        aria-pressed={radio.state === "playing"}
        title={`${label} · The Long Way Home`}
      >
        <RadioOrbit />
      </button>
      <span className={styles.srOnly} role="status">
        Space radio: {stateLabel[radio.state]}
        {radio.state === "playing" && radio.volume === 0 ? " · Muted" : ""}
      </span>
    </div>
  );
}

/** A header inlet, not another player: audio remains owned by the root provider. */
export function AmbientRadioControls() {
  const radio = useContext(RadioContext);
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const volumeInput = useRef<HTMLInputElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!expanded) return;
    volumeInput.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setExpanded(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded]);
  if (!radio) return null;
  const { state, volume, toggle, changeVolume } = radio;
  const playing = active(state);
  const closePanel = () => {
    setExpanded(false);
    expandButton.current?.focus({ preventScroll: true });
  };
  return (
    <div
      ref={root}
      className={styles.dock}
      data-ambient-radio
      data-state={state}
      data-expanded={expanded}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.preventDefault();
          event.stopPropagation();
          closePanel();
        }
      }}
    >
      <div className={styles.pill}>
        <button
          type="button"
          className={styles.play}
          onClick={toggle}
          aria-label={playing ? "Pause space radio" : "Play space radio"}
        >
          <RadioOrbit />
        </button>
        <button
          type="button"
          ref={expandButton}
          className={styles.expand}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={
            expanded ? "Hide space radio controls" : "Show space radio controls"
          }
          onClick={() => setExpanded((value) => !value)}
        >
          <span>
            <strong>Space radio</strong>
            <small role="status">
              {stateLabel[state]}
              {state === "playing" && volume === 0 ? " · Muted" : ""}
            </small>
          </span>
          <ChevronDown
            size={15}
            style={{ transform: expanded ? "rotate(180deg)" : undefined }}
          />
        </button>
      </div>
      {expanded && (
        <section
          id={panelId}
          className={styles.panel}
          aria-label="Space radio controls"
        >
          <header>
            <span>
              <Orbit size={17} /> SPACE RADIO
            </span>
            <button
              type="button"
              onClick={closePanel}
              aria-label="Close radio controls"
            >
              <X size={17} />
            </button>
          </header>
          <div className={styles.station}>
            <RadioOrbit />
            <div>
              <h2>The Long Way Home</h2>
              <p>A quiet journey through the stars.</p>
            </div>
          </div>
          <div className={styles.volumeLabel}>
            <label htmlFor={`${panelId}-volume`}>
              <Volume2 size={15} /> Volume
            </label>
            <output>{Math.round(volume * 100)}%</output>
          </div>
          <input
            ref={volumeInput}
            id={`${panelId}-volume`}
            aria-label="Space radio volume"
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(volume * 100)}
            onChange={(event) => changeVolume(Number(event.target.value) / 100)}
          />
          <p className={styles.note}>
            {state === "error"
              ? "Audio could not start. Try Play again or use another browser."
              : state === "suspended"
                ? "Your browser paused the sound. Press Play to resume."
                : "Original ambient sound. Starts only when you play."}
          </p>
        </section>
      )}
    </div>
  );
}
