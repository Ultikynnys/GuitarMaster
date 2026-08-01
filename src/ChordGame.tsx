import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ChordResult, PitchResult } from "./audioDetection";
import { chordPluckTiming, stepDurationSeconds } from "./playbackTiming";
import { loadSamples, playSample, type SampleMap } from "./sampleEngine";
import { buildCatalog, type ProgressionStep } from "./songCatalog";

type ChordShape = {
  name: string;
  frets: [string, string, string, string, string, string];
  fingerNumbers: [string, string, string, string, string, string];
};

const songDocuments = import.meta.glob("./songs/*.json", { eager: true, import: "default" });
const LEVELS = buildCatalog(songDocuments);

const CHORDS: Record<string, ChordShape> = {
  A: { name: "A major", frets: ["0", "2", "2", "2", "0", "x"], fingerNumbers: ["", "3", "2", "1", "", ""] },
  Am: { name: "A minor", frets: ["0", "1", "2", "2", "0", "x"], fingerNumbers: ["", "1", "3", "2", "", ""] },
  C: { name: "C major", frets: ["0", "1", "0", "2", "3", "x"], fingerNumbers: ["", "1", "", "2", "3", ""] },
  D: { name: "D major", frets: ["2", "3", "2", "0", "x", "x"], fingerNumbers: ["2", "3", "1", "", "", ""] },
  Dm: { name: "D minor", frets: ["1", "3", "2", "0", "x", "x"], fingerNumbers: ["1", "3", "2", "", "", ""] },
  E: { name: "E major", frets: ["0", "0", "1", "2", "2", "0"], fingerNumbers: ["", "", "1", "3", "2", ""] },
  Em: { name: "E minor", frets: ["0", "0", "0", "2", "2", "0"], fingerNumbers: ["", "", "", "3", "2", ""] },
  F: { name: "F major", frets: ["1", "1", "2", "3", "3", "1"], fingerNumbers: ["1", "1", "2", "4", "3", "1"] },
  G: { name: "G major", frets: ["3", "0", "0", "0", "2", "3"], fingerNumbers: ["3", "", "", "", "1", "2"] },
};

const REQUIRED_FRAMES = 4;
const DIAGRAM_STRING_NAMES = ["E", "A", "D", "G", "B", "e"];
const TAB_STRING_NAMES = ["e", "B", "G", "D", "A", "E"];
const OPEN_STRING_FREQUENCIES = [329.63, 246.94, 196, 146.83, 110, 82.41];
const NOTE_OFFSETS: Record<string, number> = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
const FRET_COUNT = 24;
const FRET_MARKERS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];

function stepLabel(step: ProgressionStep): string {
  if (step.type === "mute") return "Mute";
  if (step.type === "chord") return step.chord;
  return `${step.note} ${step.octave}`;
}

function stepBeats(step: ProgressionStep): number {
  return step.beats;
}

function formatBeats(beats: number): string {
  const rounded = Math.round(beats * 100) / 100;
  return `${rounded} ${rounded === 1 ? "beat" : "beats"}`;
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
  if (step.type === "mute") return { name: "Mute", frets, fingerNumbers };
  frets[step.string] = String(step.fret);
  fingerNumbers[step.string] = step.finger;
  return {
    name: `${step.note}${step.octave} / ${TAB_STRING_NAMES[step.string]} string`,
    frets,
    fingerNumbers,
  };
}

function ChordTab({ chord, nextChord, showArrows, showGhosts }: { chord: ChordShape; nextChord: ChordShape; showArrows: boolean; showGhosts: boolean }) {
  const diagramFrets = [...chord.frets].reverse();
  const diagramFingers = [...chord.fingerNumbers].reverse();
  const nextDiagramFrets = [...nextChord.frets].reverse();
  const nextDiagramFingers = [...nextChord.fingerNumbers].reverse();
  const fingerTransitions = ["1", "2", "3", "4"].flatMap((finger) => {
    const positions = (frets: string[], fingers: string[]) => frets.flatMap((fret, string) => (
      fingers[string] === finger && Number(fret) > 0 ? [{ string, fret: Number(fret) }] : []
    ));
    const currentPositions = positions(diagramFrets, diagramFingers);
    const nextPositions = positions(nextDiagramFrets, nextDiagramFingers);
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
        <strong>{chord.name}</strong>
      </div>
      <div className="chord-diagram" aria-label={`${chord.name} chord diagram`}>
        <div className="string-status">
          {diagramFrets.map((fret, index) => <span key={DIAGRAM_STRING_NAMES[index]}>{fret === "0" ? "o" : fret === "x" ? "x" : ""}</span>)}
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
                {currentPosition
                  ? <b className={`finger-${finger}`}>{finger}</b>
                  : showGhosts && nextPosition && !currentPosition && <b className={`next-finger finger-${nextFinger}`}>{nextFinger}</b>}
              </i>
            );
          })}
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

export default function ChordGame({ detectedChord, detectedPitch, listening, inputLevel }: { detectedChord: ChordResult | null; detectedPitch: PitchResult | null; listening: boolean; inputLevel: number }) {
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
  const [bpm, setBpm] = useState(LEVELS[0].categories[0].progressions[0].recommendedBpm);
  const [autoplaying, setAutoplaying] = useState(false);
  const [autoplayIndex, setAutoplayIndex] = useState(-1);
  const [showArrows, setShowArrows] = useState(true);
  const [showGhosts, setShowGhosts] = useState(true);
  const startedAt = useRef(0);
  const feedbackAudioContext = useRef<AudioContext | null>(null);
  const autoplayTimer = useRef<number | null>(null);
  const autoplayGeneration = useRef(0);
  const autoplaySources = useRef(new Set<AudioBufferSourceNode>());
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
  const currentLabel = stepLabel(currentStep);
  const currentChordName = currentStep.type === "chord" ? currentStep.chord : null;
  const currentIsMute = currentStep.type === "mute";
  const currentNote = currentStep.type === "note" ? currentStep : null;
  const currentIsChord = currentChordName !== null;
  const currentMatches = currentIsChord
    ? detectedChord?.name === currentChordName && detectedChord.confidence >= 0.48
    : currentNote !== null && detectedPitch?.note === currentNote.note && detectedPitch.octave === currentNote.octave && detectedPitch.confidence >= 0.65;
  const requiredFrames = currentIsChord ? REQUIRED_FRAMES : 2;
  const heardLabel = currentIsChord
    ? detectedChord?.name
    : detectedPitch ? `${detectedPitch.note} ${detectedPitch.octave}` : undefined;
  const visualIndex = autoplaying && autoplayIndex >= 0 ? autoplayIndex : currentIndex;
  const visualStep = progression.steps[visualIndex] ?? progression.steps[0];
  const visualNextStep = progression.steps[(visualIndex + 1) % progression.steps.length];
  const visualIsMute = visualStep.type === "mute";
  const visualIsChord = visualStep.type === "chord";
  const visualLabel = stepLabel(visualStep);
  const signalTooLow = listening && inputLevel < minimumSignal;

  useEffect(() => {
    if (mode !== "playing") return;
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 100);
    return () => window.clearInterval(timer);
  }, [mode]);

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
    // Zero attack on retrigger — the string is already in motion, no ramp needed.
    const source = playSample(frequency, startTime, volume, duration, context, samples, autoplaySources.current, retrigger ? 0 : undefined);
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
    if (step.type === "mute") return;
    if (step.type === "note") {
      const midi = (step.octave + 1) * 12 + NOTE_OFFSETS[step.note];
      playPluck(440 * 2 ** ((midi - 69) / 12), startTime, 0.28, sustainDuration, step.string);
      return;
    }
    const chordName = step.chord;
    CHORDS[chordName].frets.forEach((fret, string) => {
      const timing = chordPluckTiming(string, sustainDuration);
      if (fret === "x" || fret === "") {
        playMutedString(startTime + timing.delay, 0.05, timing.duration);
        return;
      }
      const frequency = OPEN_STRING_FREQUENCIES[string] * 2 ** (Number(fret) / 12);
      playPluck(frequency, startTime + timing.delay, 0.11, timing.duration, string);
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
    if (currentMatches) {
      setHoldFrames((value) => Math.min(requiredFrames, value + 1));
    } else {
      setHoldFrames(0);
    }
  }, [currentIsMute, currentMatches, detectedChord?.confidence, detectedChord?.name, detectedPitch?.confidence, detectedPitch?.note, detectedPitch?.octave, listening, mode, requiredFrames, signalTooLow]);

  useEffect(() => {
    if (mode !== "playing" || !currentIsMute) return;
    const timer = window.setTimeout(
      () => setHoldFrames(requiredFrames),
      (60_000 / bpm) * stepBeats(currentStep),
    );
    return () => window.clearTimeout(timer);
  }, [bpm, currentIsMute, currentStep, mode, requiredFrames]);

  useEffect(() => {
    if (mode !== "playing" || holdFrames < requiredFrames) return;
    const completedLoop = currentIndex === progression.steps.length - 1;
    if (!currentIsMute) playClick("tick", acceptedStepVolume);
    if (completedLoop) playClick("tock", acceptedStepVolume, 0.1);
    if (!currentIsMute) setScore((value) => value + 100 + currentIndex * 25);
    setHoldFrames(0);
    if (completedLoop) {
      setLoops((value) => value + 1);
      setCurrentIndex(0);
    } else {
      setCurrentIndex((value) => value + 1);
    }
  }, [acceptedStepVolume, currentIndex, currentIsMute, holdFrames, mode, progression.steps.length, requiredFrames]);

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
    setMode("playing");
  }

  function stopGame() {
    setMode("ready");
    setCurrentIndex(0);
    setHoldFrames(0);
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
          <label htmlFor="progression">Progression</label>
          <select id="progression" value={progressionId} onChange={(event) => selectProgression(event.target.value)}>
            {category.progressions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>

          <div className="autoplay-controls">
            <div className="autoplay-heading">
              <label htmlFor="preview-bpm">Autoplay tempo</label>
              <output>{bpm} BPM</output>
            </div>
            <input
              id="preview-bpm"
              type="range"
              min="50"
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
            <div className="autoplay-toggle">
              <div><strong>Repeat autoplay</strong><span>Loops until switched off</span></div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={autoplaying}
                  disabled={mode === "playing"}
                  onChange={(event) => event.target.checked ? void startAutoplay() : stopAutoplay()}
                />
                <i />
              </label>
            </div>
            <div className="autoplay-toggle metronome-toggle">
              <div><strong>Metronome</strong><span>Accents beat 1 in {progression.beatsPerBar}/4</span></div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={metronomeEnabled}
                  onChange={(event) => {
                    if (event.target.checked) prepareFeedbackAudio();
                    setMetronomeEnabled(event.target.checked);
                  }}
                />
                <i />
              </label>
            </div>
            <div className="autoplay-toggle">
              <div><strong>Finger arrows</strong><span>Show transition arrows between chords</span></div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showArrows}
                  onChange={(event) => setShowArrows(event.target.checked)}
                />
                <i />
              </label>
            </div>
            <div className="autoplay-toggle">
              <div><strong>Next-finger ghosts</strong><span>Show semi-transparent upcoming positions</span></div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showGhosts}
                  onChange={(event) => setShowGhosts(event.target.checked)}
                />
                <i />
              </label>
            </div>
          </div>

          <div className="sequence" aria-label="Progression sequence">
            {progression.steps.map((step, index) => (
              <div
                key={`${stepLabel(step)}-${index}`}
                className={`${!autoplaying && index < currentIndex ? "passed" : !autoplaying && index === currentIndex ? "current" : ""} ${index === autoplayIndex ? "previewing" : ""}`}
                style={{ "--duration-hue": durationHue(stepBeats(step)) } as CSSProperties}
              >
                <span>{index < currentIndex ? "OK" : String(index + 1).padStart(2, "0")}</span>
                <strong className={stepLabel(step).length > 4 ? "label-long" : stepLabel(step).length > 2 ? "label-medium" : ""}>{stepLabel(step)}</strong>
                <small>{formatBeats(stepBeats(step))}</small>
              </div>
            ))}
          </div>

          <div className={`game-feedback ${!currentIsMute && signalTooLow ? "low-signal" : currentMatches ? "matching" : ""}`}>
            {mode === "playing" ? (
              <>
                <span>{currentIsMute ? "TIMED MUTE" : signalTooLow ? "READING IGNORED" : heardLabel ? `HEARD ${heardLabel}` : "LISTENING..."}</span>
                <strong>{currentIsMute ? `Mute for ${formatBeats(stepBeats(currentStep))}` : signalTooLow ? "Signal too low" : currentMatches ? "Hold it" : `Play ${currentLabel}`}</strong>
                <i><b style={{ width: `${(holdFrames / requiredFrames) * 100}%` }} /></i>
              </>
            ) : (
              <span>READY</span>
            )}
          </div>

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

          {!listening && <p className="game-warning">Enable the guitar input above to start playing.</p>}
          <button onClick={mode === "playing" ? stopGame : startGame} disabled={!listening || autoplaying}>{mode === "playing" ? "Stop session" : "Start sequence"}</button>
        </div>

        <div className="current-chord">
          <div className="next-label">{autoplaying ? "AUTOPLAY" : visualIsMute ? "MUTE" : `PLAY THIS ${visualIsChord ? "CHORD" : "NOTE"}`}<span>{visualIndex + 1} / {progression.steps.length}</span></div>
          <div className={`game-chord-name ${visualLabel.length > 5 ? "long-label" : visualLabel.length > 2 ? "medium-label" : ""}`}>{visualLabel}</div>
        </div>
        <div className="tab-panel">
          <ChordTab chord={shapeForStep(visualStep)} nextChord={shapeForStep(visualNextStep)} showArrows={showArrows} showGhosts={showGhosts} />
        </div>
      </div>
    </section>
  );
}
