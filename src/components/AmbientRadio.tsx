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
const volumeStorageKey = "investor-desk:ambient-volume:v1";
const pausedStorageKey = "investor-desk:ambient-paused:v1";
const stateLabel: Record<AmbientState, string> = {
  idle: "Sound off",
  starting: "Starting…",
  playing: "Playing",
  pausing: "Fading out…",
  paused: "Paused",
  suspended: "Tap to resume",
  error: "Playback unavailable",
};
export type AsteroidImpactSound = (gold: boolean) => () => void;
export type BlastLaunchSound = () => () => void;
const noImpact = () => {};
const silentImpact: AsteroidImpactSound = () => noImpact;
const silentLaunch: BlastLaunchSound = () => noImpact;

const RadioContext = createContext<{
  state: AmbientState;
  volume: number;
  motionVisible: boolean;
  toggle: () => void;
  requestAutoPlay: () => () => void;
  changeVolume: (value: number) => void;
  playImpact: AsteroidImpactSound;
  playLaunch: BlastLaunchSound;
} | null>(null);

/** Stable across playback/volume updates so decorative emitters keep their clock. */
export function useAsteroidImpactSound(): AsteroidImpactSound {
  return useContext(RadioContext)?.playImpact ?? silentImpact;
}

/** The visual launch clock can retain this callback across radio state changes. */
export function useBlastLaunchSound(): BlastLaunchSound {
  return useContext(RadioContext)?.playLaunch ?? silentLaunch;
}

export function AmbientRadio({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AmbientState>("idle");
  const [volume, setVolume] = useState(initialAmbientVolume);
  const [motionVisible, setMotionVisible] = useState(false);
  const engine = useRef<AmbientAudio | null>(null);
  const volumeRef = useRef(initialAmbientVolume);
  const stateRef = useRef<AmbientState>("idle");
  const preferencesRead = useRef(false);
  const userPaused = useRef(false);
  const updateState = useCallback((next: AmbientState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const readPreferences = useCallback(() => {
    if (preferencesRead.current) return;
    preferencesRead.current = true;
    try {
      const stored = localStorage.getItem(volumeStorageKey);
      const value = stored === null ? NaN : Number(stored);
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        volumeRef.current = value;
        setVolume(value);
      }
    } catch {
      /* Restricted storage does not prevent listening. */
    }
    try {
      userPaused.current = sessionStorage.getItem(pausedStorageKey) === "true";
    } catch {
      /* The current provider still remembers a deliberate pause. */
    }
    if (userPaused.current && stateRef.current === "idle")
      updateState("paused");
  }, [updateState]);
  const play = useCallback(() => {
    readPreferences();
    engine.current ??= new AmbientAudio(updateState);
    const player = engine.current;
    player.setVolume(volumeRef.current);
    void Promise.resolve(player.play()).catch(() => {
      if (engine.current === player) updateState("error");
    });
  }, [readPreferences, updateState]);
  const toggle = useCallback(() => {
    readPreferences();
    const pause = active(stateRef.current);
    userPaused.current = pause;
    try {
      sessionStorage.setItem(pausedStorageKey, String(pause));
    } catch {
      /* Playback controls still work when storage is restricted. */
    }
    if (pause) engine.current?.pause();
    else play();
  }, [play, readPreferences]);
  const requestAutoPlay = useCallback(() => {
    // A homepage can opt in without making direct workspace visits audible.
    // Read synchronously: child effects run before the provider's mount effect.
    readPreferences();
    const permitted = () => !userPaused.current && volumeRef.current > 0;
    const resume = (event: MouseEvent | KeyboardEvent) => {
      if (!permitted() || document.visibilityState !== "visible") return;
      // The radio's own controls handle this gesture; resuming here as well
      // would turn their subsequent toggle into a pause.
      if (
        event.target instanceof Element &&
        event.target.closest("[data-radio-toggle]")
      )
        return;
      if (
        event instanceof KeyboardEvent &&
        (event.repeat ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          ["Escape", "Shift", "Control", "Alt", "Meta"].includes(event.key))
      )
        return;
      if (stateRef.current === "starting" || stateRef.current === "suspended")
        play();
    };
    document.addEventListener("click", resume, true);
    document.addEventListener("keydown", resume, true);
    if (
      permitted() &&
      (!engine.current ||
        stateRef.current === "idle" ||
        stateRef.current === "suspended")
    )
      play();
    return () => {
      document.removeEventListener("click", resume, true);
      document.removeEventListener("keydown", resume, true);
    };
  }, [play, readPreferences]);
  const playImpact = useCallback<AsteroidImpactSound>((gold) => {
    if (
      stateRef.current !== "playing" ||
      volumeRef.current <= 0 ||
      document.visibilityState !== "visible"
    )
      return noImpact;
    return engine.current?.playImpact(gold) ?? noImpact;
  }, []);
  const playLaunch = useCallback<BlastLaunchSound>(() => {
    if (
      stateRef.current !== "playing" ||
      volumeRef.current <= 0 ||
      document.visibilityState !== "visible"
    )
      return noImpact;
    return engine.current?.playLaunch() ?? noImpact;
  }, []);
  const changeVolume = useCallback((value: number) => {
    const next = Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : initialAmbientVolume;
    volumeRef.current = next;
    setVolume(next);
    engine.current?.setVolume(next);
    try {
      localStorage.setItem(volumeStorageKey, String(next));
    } catch {
      /* Volume still works. */
    }
  }, []);
  useEffect(() => {
    const visibility = () => {
      const visible = document.visibilityState === "visible";
      setMotionVisible(visible);
      // Background music is intentional; transient visual effects are not.
      if (!visible) {
        engine.current?.cancelImpact();
        engine.current?.cancelLaunch();
      }
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    // Fast Refresh retains React state/refs while rerunning effect cleanup.
    // A disposed engine must not leave a stuck Playing label or auto-resume.
    if (!engine.current && stateRef.current !== "idle") updateState("paused");
    readPreferences();
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
  }, [readPreferences, updateState]);
  return (
    <RadioContext.Provider
      value={{
        state,
        volume,
        motionVisible,
        toggle,
        requestAutoPlay,
        changeVolume,
        playImpact,
        playLaunch,
      }}
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
      data-radio-toggle
      aria-label={playing ? "Pause space radio" : "Resume space radio"}
      title={playing ? "Pause space radio" : "Resume space radio"}
    >
      <RadioOrbit />
    </button>
  );
}

/** The homepage's quiet inlet; it shares the same player as the full controls. */
export function AmbientRadioOrb({ autoPlay = false }: { autoPlay?: boolean }) {
  const radio = useContext(RadioContext);
  const requestAutoPlay = radio?.requestAutoPlay;
  useEffect(() => {
    if (autoPlay) return requestAutoPlay?.();
  }, [autoPlay, requestAutoPlay]);
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
        data-radio-toggle
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
          data-radio-toggle
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
                : "Original ambient sound. Follows your playback and volume choices."}
          </p>
        </section>
      )}
    </div>
  );
}
