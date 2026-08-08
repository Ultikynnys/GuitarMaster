import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ChordResult, PitchResult } from "./audioDetection";
import { chordPluckTiming, stepDurationSeconds } from "./playbackTiming";
import { loadSamples, playSample, type SampleMap } from "./sampleEngine";
import { buildCatalog, stepLabel, type ProgressionStep } from "./songCatalog";
import TabTimeline from "./TabTimeline";
import { CHORDS, type ChordShape } from "./chords";

const songDocuments = import.meta.glob("./songs/*.json", { eager: true, import: "default" });
const LEVELS = buildCatalog(songDocuments);

const REQUIRED_FRAMES = 4;
const DIAGRAM_STRING_NAMES = ["E", "A", "D", "G", "B", "e"];
const TAB_STRING_NAMES = ["e", "B", "G", "D", "A", "E"];
const OPEN_STRING_FREQUENCIES = [329.63, 246.94, 196, 146.83, 110, 82.41];
const NOTE_OFFSETS: Record<string, number> = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
const FRET_COUNT = 24;
const FRET_MARKERS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];

function stepBeats(step: ProgressionStep): number {
  return step.beats;
}

function durationHue(beats: number): number {
  if (beats <= 0.5) return 195;
  if (beats <= 1) return 42;
  if (beats <= 1.5) return 285;
  return 345;
}

function shapeForStep(step: ProgressionStep): ChordShape {
  if (step.type === "chord") return CHORDS[step.chord];
  const frets: ChordShape["frets"] = ["", "", "", "", "", ""];
  const fingerNumbers: ChordShape["fingerNumbers"] = ["", "", "", "", "", ""];
  frets[step.string] = String(step.fret);
  fingerNumbers[step.string] = step.finger;
  return {
    name: `${step.note}${step.octave} / ${TAB_STRING_NAMES[step.string]} string`,
    frets,
    fingerNumbers,
  };
}

function ChordTab({ chord, nextChord, showArrows, showGhosts, muted }: { chord: ChordShape; nextChord: ChordShape; showArrows: boolean; showGhosts: boolean; muted?: boolean }) {
  const diagramFrets = [...chord.frets].reverse();
  const diagramFingers = [...chord.fingerNumbers].reverse();
  const nextDiagramFrets = [...nextChord.frets].reverse();
  const nextDiagramFingers = [...nextChord.fingerNumbers].reverse();
  // A barre is ONE finger across several strings. Map it into diagram space
  // (low E leftmost) and anchor it at its lowest string so it counts as a
  // single position for transitions instead of one per string.
  const barre = chord.barre ? {
    fret: chord.barre.fret,
    from: 5 - chord.barre.to,
    to: 5 - chord.barre.from,
    finger: chord.fingerNumbers[chord.barre.from],
  } : null;
  const nextBarre = nextChord.barre ? {
    fret: nextChord.barre.fret,
    from: 5 - nextChord.barre.to,
    to: 5 - nextChord.barre.from,
    finger: nextChord.fingerNumbers[nextChord.barre.from],
  } : null;
  const onBarre = (barreInfo: typeof barre, fret: number, string: number) =>
    barreInfo !== null && fret === barreInfo.fret && string >= barreInfo.from && string <= barreInfo.to;
  const fingerTransitions = ["1", "2", "3", "4"].flatMap((finger) => {
    const positions = (frets: string[], fingers: string[], barreInfo: typeof barre) => frets.flatMap((fret, string) => {
      if (fingers[string] !== finger || Number(fret) <= 0) return [];
      if (barreInfo !== null && finger === barreInfo.finger && string >= barreInfo.from && string <= barreInfo.to) {
        return string === barreInfo.from ? [{ string, fret: Number(fret) }] : [];
      }
      return [{ string, fret: Number(fret) }];
    });
    const currentPositions = positions(diagramFrets, diagramFingers, barre);
    const nextPositions = positions(nextDiagramFrets, nextDiagramFingers, nextBarre);
    if (currentPositions.length === 0 || nextPositions.length === 0) return [];
    return Array.from({ length: Math.max(currentPositions.length, nextPositions.length) }, (_, index) => ({
      finger,
      from: currentPositions[Math.min(index, currentPositions.length - 1)],
      to: nextPositions[Math.min(index, nextPositions.length - 1)],
    })).filter(({ from, to }) => from.string !== to.string || from.fret !== to.fret);
  });

  return (
    <div className="tab-card">
      <div className="tab-heading">
        <strong>{muted ? "Mute" : chord.name}</strong>
      </div>
      <div className="chord-diagram" aria-label={`${chord.name} chord diagram`}>
        <div className="string-status">
          {diagramFrets.map((fret, index) => <span key={DIAGRAM_STRING_NAMES[index]}>{muted ? "x" : fret === "0" ? "o" : fret === "x" ? "x" : ""}</span>)}
        </div>
        <div className="fret-grid">
          {Array.from({ length: FRET_COUNT * 6 }, (_, index) => {
            const fret = Math.floor(index / 6) + 1;
            const string = index % 6;
            const finger = diagramFingers[string];
            const nextFinger = nextDiagramFingers[string];
            const currentPosition = diagramFrets[string] === String(fret);
            const nextPosition = nextDiagramFrets[string] === String(fret);
            return (
              <i key={index}>
                {currentPosition && !onBarre(barre, fret, string)
                  ? <b className={`finger-${finger}`}>{finger}</b>
                  : showGhosts && nextPosition && !currentPosition && !onBarre(nextBarre, fret, string) && <b className={`next-finger finger-${nextFinger}`}>{nextFinger}</b>}
              </i>
            );
          })}
          {barre && <b className={`barre finger-${barre.finger}`} style={{ gridColumn: `${barre.from + 1} / ${barre.to + 2}`, gridRow: barre.fret }} />}
          {showGhosts && nextBarre && nextBarre.fret !== barre?.fret && <b className={`barre next-barre finger-${nextBarre.finger}`} style={{ gridColumn: `${nextBarre.from + 1} / ${nextBarre.to + 2}`, gridRow: nextBarre.fret }} />}
          {showArrows && <svg className="finger-transitions" viewBox={`0 0 600 ${FRET_COUNT * 100}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              {["1", "2", "3", "4"].map((finger) => <marker key={finger} id={`finger-arrow-${finger}`} className={`finger-${finger}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" /></marker>)}
            </defs>
            {fingerTransitions.map(({ finger, from, to }, index) => {
              const x1 = (from.string + 0.5) * 100;
              const y1 = (from.fret - 0.5) * 100;
              const x2 = (to.string + 0.5) * 100;
              const y2 = (to.fret - 0.5) * 100;
              return <line key={`${finger}-${index}`} className={`finger-${finger}`} x1={x1} y1={y1} x2={x2} y2={y2} markerEnd={`url(#finger-arrow-${finger})`} />;
            })}
          </svg>}
          <div className="fret-inlays" aria-hidden="true">
            {FRET_MARKERS.map((fret) => <i key={fret} className={fret % 12 === 0 ? "double" : ""} style={{ "--fret-position": `${((fret - 0.5) / FRET_COUNT) * 100}%` } as CSSProperties} />)}
          </div>
          <div className="fret-labels">{Array.from({ length: FRET_COUNT }, (_, index) => <span key={index + 1}>{index + 1}</span>)}</div>
        </div>
        <div className="diagram-string-names">
          {DIAGRAM_STRING_NAMES.map((name) => <span key={name}>{name}</span>)}
        </div>
      </div>
    </div>
  );
}

function SettingToggle({ title, description, checked, disabled, onChange }: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="autoplay-toggle">
      <div><strong>{title}</strong><span>{description}</span></div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <i />
      </label>
    </div>
  );
}

export default function ChordGame({ detectedChord, detectedPitch, listening, inputLevel, attackCount }: { detectedChord: ChordResult | null; detectedPitch: PitchResult | null; listening: boolean; inputLevel: number; attackCount: number }) {
  const [levelId, setLevelId] = useState<string>(LEVELS[0].id);
  const [categoryId, setCategoryId] = useState<string>(LEVELS[0].categories[0].id);
  const [progressionId, setProgressionId] = useState<string>(LEVELS[0].categories[0].progressions[0].id);
  const [mode, setMode] = useState<"ready" | "playing">("ready");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [holdFrames, setHoldFrames] = useState(0);
  const [score, setScore] = useState(0);
  const [loops, setLoops] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [acceptedStepVolume, setAcceptedStepVolume] = useState(0.5);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [metronomeVolume, setMetronomeVolume] = useState(0.35);
  const [minimumSignal, setMinimumSignal] = useState(0.08);
  const [barSaturation, setBarSaturation] = useState(0.6);
  const [bpm, setBpm] = useState(LEVELS[0].categories[0].progressions[0].recommendedBpm);
  const [autoplaying, setAutoplaying] = useState(false);
  const [autoplayIndex, setAutoplayIndex] = useState(-1);
  const [showArrows, setShowArrows] = useState(true);
  const [showGhosts, setShowGhosts] = useState(true);
  const [zenMode, setZenMode] = useState(true);
  const [tabView, setTabView] = useState<"chord" | "timeline">("chord");
  const startedAt = useRef(0);
  const feedbackAudioContext = useRef<AudioContext | null>(null);
  const autoplayTimer = useRef<number | null>(null);
  const autoplayGeneration = useRef(0);
  const autoplaySources = useRef(new Set<AudioBufferSourceNode>());
  const needsRelease = useRef(false);
  const lastAcceptedIndexRef = useRef(-1);
  const prevAttackCount = useRef(attackCount);
  const activeStringSource = useRef(new Map<number, AudioBufferSourceNode>());
  const samplesRef = useRef<SampleMap | null>(null);
  const metronomeTimer = useRef<number | null>(null);
  const metronomeBeat = useRef(0);
  const bpmRef = useRef(bpm);
  const beatsPerBarRef = useRef(4);
  const metronomeVolumeRef = useRef(metronomeVolume);
  const level = LEVELS.find((item) => item.id === levelId) ?? LEVELS[0];
  const category = level.categories.find((item) => item.id === categoryId) ?? level.categories[0];
  const progression = category.progressions.find((item) => item.id === progressionId) ?? category.progressions[0];
  bpmRef.current = bpm;
  beatsPerBarRef.current = progression.beatsPerBar;
  metronomeVolumeRef.current = metronomeVolume;
  const currentStep = progression.steps[currentIndex] ?? progression.steps[0];
  const currentChordName = currentStep.type === "chord" ? currentStep.chord : null;
  const currentIsMute = currentStep.type === "chord" && currentStep.muted === true;
  const currentNote = currentStep.type === "note" ? currentStep : null;
  const currentIsChord = currentChordName !== null;
  const currentMatches = currentIsChord
    ? detectedChord?.name === currentChordName && detectedChord.confidence >= 0.48
    : currentNote !== null && detectedPitch?.note === currentNote.note && detectedPitch.octave === currentNote.octave && detectedPitch.confidence >= 0.65;
  const requiredFrames = currentIsChord ? REQUIRED_FRAMES : 2;
  const visualIndex = autoplaying && autoplayIndex >= 0 ? autoplayIndex : currentIndex;
  const visualStep = progression.steps[visualIndex] ?? progression.steps[0];
  const visualNextStep = progression.steps[(visualIndex + 1) % progression.steps.length];
  const signalTooLow = listening && inputLevel < minimumSignal;

  useEffect(() => {
    if (mode !== "playing") return;
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 100);
    return () => window.clearInterval(timer);
  }, [mode]);

  // Clear the release gate on every detected strum attack so repeated
  // strums of the same chord are accepted without muting in between.
  useEffect(() => {
    if (attackCount !== prevAttackCount.current) {
      prevAttackCount.current = attackCount;
      needsRelease.current = false;
    }
  }, [attackCount]);

  useEffect(() => () => {
    if (autoplayTimer.current !== null) window.clearTimeout(autoplayTimer.current);
    if (metronomeTimer.current !== null) window.clearTimeout(metronomeTimer.current);
    if (feedbackAudioContext.current) void feedbackAudioContext.current.close();
  }, []);

  useEffect(() => {
    if (!metronomeEnabled) {
      stopMetronome();
      return;
    }
    prepareFeedbackAudio();
    startMetronome();
    return stopMetronome;
  }, [metronomeEnabled, progression.id]);

  async function prepareFeedbackAudio() {
    if (!feedbackAudioContext.current || feedbackAudioContext.current.state === "closed") {
      feedbackAudioContext.current = new AudioContext({ latencyHint: "interactive" });
    }
    if (feedbackAudioContext.current.state === "suspended") await feedbackAudioContext.current.resume();
    if (!samplesRef.current) {
      samplesRef.current = await loadSamples(feedbackAudioContext.current);
    }
  }

  function playClick(kind: "tick" | "tock", volume: number, delay = 0) {
    const context = feedbackAudioContext.current;
    if (!context || volume === 0) return;
    const duration = kind === "tick" ? 0.035 : 0.075;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) {
      const envelope = 1 - index / samples.length;
      samples[index] = (Math.random() * 2 - 1) * envelope * envelope;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const now = context.currentTime + delay;
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(kind === "tick" ? 3200 : 950, now);
    filter.Q.setValueAtTime(kind === "tick" ? 0.9 : 1.4, now);
    gain.gain.setValueAtTime(Math.max(0.0001, volume * (kind === "tick" ? 0.5 : 0.65)), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(now);
    source.stop(now + duration);
  }

  function playFeedback(kind: "accept" | "loop" | "miss", volume: number, delay = 0) {
    const context = feedbackAudioContext.current;
    if (!context || volume === 0) return;
    const now = context.currentTime + delay;
    const osc = context.createOscillator();
    const gain = context.createGain();
    if (kind === "miss") {
      // Descending low buzz: unmistakably "wrong", unlike the confirm beeps.
      osc.type = "square";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.22);
      gain.gain.setValueAtTime(Math.max(0.0001, volume * 0.3), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    } else {
      osc.type = "sine";
      osc.frequency.setValueAtTime(kind === "accept" ? 880 : 523, now);
      gain.gain.setValueAtTime(Math.max(0.0001, volume * 0.4), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "accept" ? 0.08 : 0.15));
    }
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(now);
    osc.stop(now + (kind === "miss" ? 0.22 : kind === "accept" ? 0.08 : 0.15));
  }

  function stopMetronome() {
    if (metronomeTimer.current !== null) window.clearTimeout(metronomeTimer.current);
    metronomeTimer.current = null;
    metronomeBeat.current = 0;
  }

  function startMetronome() {
    stopMetronome();
    const playBeat = () => {
      const beat = metronomeBeat.current;
      playClick(beat === 0 ? "tock" : "tick", metronomeVolumeRef.current);
      metronomeBeat.current = (beat + 1) % beatsPerBarRef.current;
      metronomeTimer.current = window.setTimeout(playBeat, 60_000 / bpmRef.current);
    };
    playBeat();
  }

  function playPluck(frequency: number, startTime: number, volume: number, duration: number, stringIndex?: number) {
    const context = feedbackAudioContext.current;
    const samples = samplesRef.current;
    if (!context) return;
    if (!samples) {
      console.warn("playPluck: samples not loaded yet, dropping note at", frequency.toFixed(1), "Hz");
      return;
    }
    // Stop the previous note on this string — on a real guitar, plucking the
    // same string again replaces the old vibration; without this, overlapping
    // samples on the same frequency phase-cancel each other into silence.
    let retrigger = false;
    if (stringIndex !== undefined) {
      const old = activeStringSource.current.get(stringIndex);
      if (old) {
        try { old.stop(); } catch { /* already stopped */ }
        activeStringSource.current.delete(stringIndex);
        retrigger = true;
      }
    }
    // Duration loudness compensation: sqrt curve so short notes get a
    // modest boost and long notes get attenuated. Reference is 0.5s
    // (one eighth note at 120 BPM). Capped at 2.5× to avoid clipping.
    const durationBoost = Math.min(2.5, Math.sqrt(0.5 / Math.max(0.04, duration)));
    const compensatedVolume = volume * durationBoost;

    // Zero attack on retrigger — the string is already in motion, no ramp needed.
    const source = playSample(frequency, startTime, compensatedVolume, duration, context, samples, autoplaySources.current, retrigger ? 0 : undefined);
    if (source && stringIndex !== undefined) {
      activeStringSource.current.set(stringIndex, source);
      source.addEventListener("ended", () => {
        if (activeStringSource.current.get(stringIndex) === source) {
          activeStringSource.current.delete(stringIndex);
        }
      }, { once: true });
    }
  }

  function playMutedString(startTime: number, volume: number, slotDuration: number) {
    const context = feedbackAudioContext.current;
    if (!context || volume === 0) return;
    // Clamp to avoid scheduling in the past (setTimeout drift on fast passages).
    const now = context.currentTime;
    if (startTime < now) startTime = now;
    const duration = Math.min(0.035, slotDuration * 0.28);
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const envelope = Math.exp(-i / (context.sampleRate * 0.006));
      samples[i] = (Math.random() * 2 - 1) * envelope;
    }
    const source = context.createBufferSource();
    const lowpass = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(320, startTime);
    lowpass.Q.setValueAtTime(0.6, startTime);
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    source.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(context.destination);
    autoplaySources.current.add(source);
    source.addEventListener("ended", () => autoplaySources.current.delete(source), { once: true });
    source.start(startTime);
    source.stop(startTime + duration);
  }

  function previewStep(step: ProgressionStep, stepBpm: number, startTime: number) {
    const context = feedbackAudioContext.current;
    if (!context) return;
    const sustainDuration = stepDurationSeconds(stepBeats(step), stepBpm);
    if (step.type === "note") {
      const midi = (step.octave + 1) * 12 + NOTE_OFFSETS[step.note];
      const freq = 440 * 2 ** ((midi - 69) / 12);
      if (step.muted) {
        // Palm-muted note: short percussive thwack, still pitched
        playPluck(freq, startTime, 0.14, Math.min(0.08, sustainDuration), step.string);
      } else {
        playPluck(freq, startTime, 0.28, sustainDuration, step.string);
      }
      return;
    }
    const chordName = step.chord;
    const chordDur = step.muted ? Math.min(0.08, sustainDuration) : sustainDuration;
    const chordVol = step.muted ? 0.06 : 0.11;
    CHORDS[chordName].frets.forEach((fret, string) => {
      const timing = chordPluckTiming(string, sustainDuration);
      if (fret === "x" || fret === "") {
        playMutedString(startTime + timing.delay, 0.05, timing.duration);
        return;
      }
      const frequency = OPEN_STRING_FREQUENCIES[string] * 2 ** (Number(fret) / 12);
      playPluck(frequency, startTime + timing.delay, chordVol, chordDur, string);
    });
  }

  function stopAutoplay() {
    autoplayGeneration.current += 1;
    if (autoplayTimer.current !== null) window.clearTimeout(autoplayTimer.current);
    autoplayTimer.current = null;
    for (const source of autoplaySources.current) {
      try {
        source.stop();
      } catch {
        // The source may already have ended between iteration and cancellation.
      }
    }
    autoplaySources.current.clear();
    setAutoplaying(false);
    setAutoplayIndex(-1);
  }

  function scheduleAutoplayStep(index: number, startTime: number, generation: number) {
    if (generation !== autoplayGeneration.current) return;
    const context = feedbackAudioContext.current;
    if (!context) return;
    const step = progression.steps[index];
    const stepBpm = bpmRef.current;
    const duration = stepDurationSeconds(stepBeats(step), stepBpm);
    setAutoplayIndex(index);
    previewStep(step, stepBpm, startTime);
    const nextStartTime = startTime + duration;
    autoplayTimer.current = window.setTimeout(() => {
      scheduleAutoplayStep((index + 1) % progression.steps.length, nextStartTime, generation);
    }, Math.max(0, (nextStartTime - context.currentTime) * 1000 - 30));
  }

  async function startAutoplay() {
    if (mode === "playing") return;
    stopAutoplay();
    const generation = autoplayGeneration.current;
    await prepareFeedbackAudio();
    if (generation !== autoplayGeneration.current) return;
    if (metronomeEnabled) startMetronome();
    setAutoplaying(true);
    const context = feedbackAudioContext.current;
    if (context) scheduleAutoplayStep(0, context.currentTime + 0.03, generation);
  }

  useEffect(() => {
    if (mode !== "playing" || currentIsMute || !listening || signalTooLow) {
      setHoldFrames(0);
      return;
    }
    if (needsRelease.current) {
      setHoldFrames(0);
      if (!currentMatches) needsRelease.current = false;
      return;
    }
    if (currentMatches) {
      setHoldFrames((value) => Math.min(requiredFrames, value + 1));
    } else {
      setHoldFrames(0);
    }
  }, [currentIsMute, currentMatches, detectedChord?.confidence, detectedChord?.name, detectedPitch?.confidence, detectedPitch?.note, detectedPitch?.octave, listening, mode, requiredFrames, signalTooLow]);

  // Paced mode (zen off): a step is hit the moment the correct chord/note
  // registers — no 4-frame hold, short steps have no time for that. The grid
  // scheduler below owns step advancement, so hits never advance the index.
  useEffect(() => {
    if (mode !== "playing" || zenMode || currentIsMute || signalTooLow) return;
    if (lastAcceptedIndexRef.current === currentIndex) return;
    if (!currentMatches) return;
    lastAcceptedIndexRef.current = currentIndex;
    needsRelease.current = true;
    setScore((value) => value + 100 + currentIndex * 25);
    const context = feedbackAudioContext.current;
    if (context) previewStep(currentStep, bpm, context.currentTime + 0.01);
  }, [bpm, currentIndex, currentIsMute, currentMatches, currentStep, mode, signalTooLow, zenMode]);

  // Paced mode (zen off): advance on a strict tempo grid. A step that was
  // not hit before its deadline is a miss (wrong sound); muted steps pass.
  useEffect(() => {
    if (mode !== "playing" || zenMode) return;
    const timer = window.setTimeout(() => {
      if (lastAcceptedIndexRef.current !== currentIndex && !currentIsMute) {
        playFeedback("miss", acceptedStepVolume);
      }
      if (currentIndex === progression.steps.length - 1) {
        setLoops((value) => value + 1);
        setCurrentIndex(0);
      } else {
        setCurrentIndex((value) => value + 1);
      }
    }, stepDurationSeconds(stepBeats(currentStep), bpm) * 1000);
    return () => window.clearTimeout(timer);
  }, [acceptedStepVolume, bpm, currentIndex, currentIsMute, mode, progression.steps.length, zenMode]);

  useEffect(() => {
    if (mode !== "playing" || !currentIsMute || !zenMode) return;
    const timer = window.setTimeout(
      () => setHoldFrames(requiredFrames),
      (60_000 / bpm) * stepBeats(currentStep),
    );
    return () => window.clearTimeout(timer);
  }, [bpm, currentIsMute, currentStep, mode, requiredFrames, zenMode]);

  useEffect(() => {
    if (mode !== "playing" || holdFrames < requiredFrames) return;
    if (!zenMode) return; // paced mode: hits/misses are handled above
    const completedLoop = currentIndex === progression.steps.length - 1;
    if (!currentIsMute) playFeedback("accept", acceptedStepVolume);
    if (completedLoop) playFeedback("loop", acceptedStepVolume, 0.1);
    if (!currentIsMute) setScore((value) => value + 100 + currentIndex * 25);
    setHoldFrames(0);
    needsRelease.current = true;
    if (completedLoop) {
      setLoops((value) => value + 1);
      setCurrentIndex(0);
    } else {
      setCurrentIndex((value) => value + 1);
    }
  }, [acceptedStepVolume, currentIndex, currentIsMute, holdFrames, mode, progression.steps.length, requiredFrames, zenMode]);

  function startGame() {
    stopAutoplay();
    prepareFeedbackAudio();
    if (metronomeEnabled) startMetronome();
    setCurrentIndex(0);
    setHoldFrames(0);
    setScore(0);
    setLoops(0);
    setElapsed(0);
    startedAt.current = Date.now();
    needsRelease.current = false;
    lastAcceptedIndexRef.current = -1;
    setMode("playing");
  }

  function stopGame() {
    setMode("ready");
    setCurrentIndex(0);
    setHoldFrames(0);
    lastAcceptedIndexRef.current = -1;
  }

  function selectLevel(id: string) {
    stopAutoplay();
    const selectedLevel = LEVELS.find((item) => item.id === id) ?? LEVELS[0];
    const firstCategory = selectedLevel.categories[0];
    setLevelId(selectedLevel.id);
    setCategoryId(firstCategory.id);
    setProgressionId(firstCategory.progressions[0].id);
    setBpm(firstCategory.progressions[0].recommendedBpm);
    setMode("ready");
    setCurrentIndex(0);
    setScore(0);
    setLoops(0);
    setElapsed(0);
  }

  function selectCategory(id: string) {
    stopAutoplay();
    const selectedCategory = level.categories.find((item) => item.id === id) ?? level.categories[0];
    setCategoryId(selectedCategory.id);
    setProgressionId(selectedCategory.progressions[0].id);
    setBpm(selectedCategory.progressions[0].recommendedBpm);
    setMode("ready");
    setCurrentIndex(0);
    setScore(0);
    setLoops(0);
    setElapsed(0);
  }

  function selectProgression(id: string) {
    stopAutoplay();
    const selectedProgression = category.progressions.find((item) => item.id === id) ?? category.progressions[0];
    setProgressionId(id);
    setBpm(selectedProgression.recommendedBpm);
    setMode("ready");
    setCurrentIndex(0);
    setScore(0);
    setLoops(0);
    setElapsed(0);
  }

  return (
    <section className="game-section">
      <div className="game-header">
        <div>
          <p className="eyebrow">CHORD TRAINER / GAME MODE</p>
          <h2>Play the progression.</h2>
        </div>
        <div className="game-stats">
          <span>Score<strong>{score}</strong></span>
          <span>Loops<strong>{loops}</strong></span>
          <span>Time<strong>{(elapsed / 1000).toFixed(1)}s</strong></span>
        </div>
      </div>

      <div className="game-layout">
        <div className="game-controls">
          <div className="autoplay-controls">
            <div className="autoplay-heading">
              <label htmlFor="preview-bpm">Autoplay tempo</label>
              <output>{bpm} BPM</output>
            </div>
            <input
              id="preview-bpm"
              type="range"
              min="20"
              max="180"
              step="1"
              value={bpm}
              title="Double-click to reset to this song's recommended BPM"
              aria-description="Double-click to reset to this song's recommended BPM"
              onChange={(event) => {
                const nextBpm = Number(event.target.value);
                bpmRef.current = nextBpm;
                setBpm(nextBpm);
              }}
              onDoubleClick={() => {
                bpmRef.current = progression.recommendedBpm;
                setBpm(progression.recommendedBpm);
              }}
            />
            <div className="volume-sliders">
              <div className="game-range-control">
                <label htmlFor="success-volume">Accepted-step tick / tock volume</label>
                <output>{Math.round(acceptedStepVolume * 100)}%</output>
                <input
                  id="success-volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={acceptedStepVolume}
                  onChange={(event) => setAcceptedStepVolume(Number(event.target.value))}
                />
              </div>
              <div className="game-range-control">
                <label htmlFor="metronome-volume">Metronome volume</label>
                <output>{Math.round(metronomeVolume * 100)}%</output>
                <input
                  id="metronome-volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={metronomeVolume}
                  onChange={(event) => setMetronomeVolume(Number(event.target.value))}
                />
              </div>
              <div className="game-range-control">
                <label htmlFor="minimum-signal">Minimum chord signal</label>
                <output>{Math.round(minimumSignal * 100)}%</output>
                <input
                  id="minimum-signal"
                  type="range"
                  min="0.06"
                  max="0.3"
                  step="0.01"
                  value={minimumSignal}
                  onChange={(event) => setMinimumSignal(Number(event.target.value))}
                />
              </div>
              <div className="game-range-control">
                <label htmlFor="bar-saturation">Tab bar saturation</label>
                <output>{Math.round(barSaturation * 100)}%</output>
                <input
                  id="bar-saturation"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={barSaturation}
                  onChange={(event) => setBarSaturation(Number(event.target.value))}
                />
              </div>
            </div>
            <SettingToggle
              title="Zen mode"
              description={zenMode ? "Play at your own pace — steps wait for you" : "Steps auto-advance on the beat; late hits miss"}
              checked={zenMode}
              onChange={setZenMode}
            />
            <SettingToggle
              title="Repeat autoplay"
              description="Loops until switched off"
              checked={autoplaying}
              disabled={mode === "playing"}
              onChange={(checked) => (checked ? void startAutoplay() : stopAutoplay())}
            />
            <SettingToggle
              title="Metronome"
              description={`Accents beat 1 in ${progression.beatsPerBar}/4`}
              checked={metronomeEnabled}
              onChange={(checked) => {
                if (checked) prepareFeedbackAudio();
                setMetronomeEnabled(checked);
              }}
            />
            <SettingToggle
              title="Finger arrows"
              description="Show transition arrows between chords"
              checked={showArrows}
              onChange={setShowArrows}
            />
            <SettingToggle
              title="Next-finger ghosts"
              description="Show semi-transparent upcoming positions"
              checked={showGhosts}
              onChange={setShowGhosts}
            />
            <SettingToggle
              title="Timeline tab"
              description="Plot the whole progression against time"
              checked={tabView === "timeline"}
              onChange={(checked) => setTabView(checked ? "timeline" : "chord")}
            />
          </div>
        </div>

        <div className="game-visual">
          <div className="game-visual-controls">
            <label>Difficulty</label>
            <div className="difficulty-levels">
              {LEVELS.map((item, index) => (
                <button key={item.id} className={item.id === levelId ? "active" : ""} onClick={() => selectLevel(item.id)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>{item.name}
                </button>
              ))}
            </div>
            <label>Category</label>
            <div className="category-tabs">
              {level.categories.map((item) => (
                <button key={item.id} className={item.id === categoryId ? "active" : ""} onClick={() => selectCategory(item.id)}>
                  {item.name}
                </button>
              ))}
            </div>
            <div className="progression-row">
              <div className="progression-select">
                <label htmlFor="progression">Progression</label>
                <select id="progression" value={progressionId} onChange={(event) => selectProgression(event.target.value)}>
                  {category.progressions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
              <div className="progression-start">
                <button className="start-sequence-button" onClick={mode === "playing" ? stopGame : startGame} disabled={!listening || autoplaying}>{mode === "playing" ? "Stop session" : "Start sequence"}</button>
              </div>
            </div>
            {!listening && <p className="game-warning">Enable the guitar input above to start playing.</p>}
          </div>
          <div className="tab-panel">
            {tabView === "timeline" ? (
              <TabTimeline steps={progression.steps} activeIndex={visualIndex} beatsPerBar={progression.beatsPerBar} saturation={barSaturation} />
            ) : (
              <ChordTab chord={shapeForStep(visualStep)} nextChord={shapeForStep(visualNextStep)} showArrows={showArrows} showGhosts={showGhosts} muted={visualStep.muted} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
