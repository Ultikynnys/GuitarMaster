import { useEffect, useRef, useState } from "react";
import type { PitchResult } from "./audioDetection";

const STRINGS = [
  { label: "Low E", short: "E", note: "E", octave: 2, frequency: 82.41 },
  { label: "A", short: "A", note: "A", octave: 2, frequency: 110 },
  { label: "D", short: "D", note: "D", octave: 3, frequency: 146.83 },
  { label: "G", short: "G", note: "G", octave: 3, frequency: 196 },
  { label: "B", short: "B", note: "B", octave: 3, frequency: 246.94 },
  { label: "High e", short: "e", note: "E", octave: 4, frequency: 329.63 },
] as const;

const REQUIRED_READINGS = 4;

export default function QuickTuner({ pitch, listening }: { pitch: PitchResult | null; listening: boolean }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [tuned, setTuned] = useState<boolean[]>(STRINGS.map(() => false));
  const [hold, setHold] = useState(0);
  const [currentFrequency, setCurrentFrequency] = useState<number | null>(null);
  const frequencyHistory = useRef<number[]>([]);
  const target = STRINGS[currentIndex];
  const centsFromTarget = currentFrequency ? Math.round(1200 * Math.log2(currentFrequency / target.frequency)) : 0;
  const correctString = currentFrequency !== null && Math.abs(centsFromTarget) < 50;
  const inTune = correctString && Math.abs(centsFromTarget) <= 7;
  const complete = tuned.every(Boolean);

  useEffect(() => {
    if (!pitch) return;
    frequencyHistory.current = [...frequencyHistory.current.slice(-6), pitch.frequency];
    const sorted = [...frequencyHistory.current].sort((left, right) => left - right);
    setCurrentFrequency(sorted[Math.floor(sorted.length / 2)]);
  }, [pitch]);

  useEffect(() => {
    frequencyHistory.current = [];
    setCurrentFrequency(null);
  }, [currentIndex]);

  useEffect(() => {
    if (!listening || currentFrequency === null || complete) {
      setHold(0);
      return;
    }
    setHold((value) => inTune ? Math.min(REQUIRED_READINGS, value + 1) : Math.max(0, value - 1));
  }, [complete, currentFrequency, inTune, listening]);

  useEffect(() => {
    if (hold < REQUIRED_READINGS) return;
    setTuned((values) => values.map((value, index) => index === currentIndex ? true : value));
    setHold(0);
    if (currentIndex < STRINGS.length - 1) setCurrentIndex((value) => value + 1);
  }, [currentIndex, hold]);

  function reset() {
    setCurrentIndex(0);
    setTuned(STRINGS.map(() => false));
    setHold(0);
    frequencyHistory.current = [];
    setCurrentFrequency(null);
  }

  return (
    <section className="quick-tuner">
      <div className="quick-tuner-heading">
        <div>
          <p className="eyebrow">QUICK TUNER</p>
          <h2>Low to high</h2>
        </div>
        <button className="tuner-reset" onClick={reset}>Restart tuning</button>
      </div>

      <div className="string-order">
        {STRINGS.map((string, index) => (
          <button
            key={string.label}
            className={`${index === currentIndex ? "active" : ""} ${tuned[index] ? "tuned" : ""}`}
            onClick={() => { setCurrentIndex(index); setHold(0); }}
          >
            <span>{tuned[index] ? "OK" : String(index + 1).padStart(2, "0")}</span>
            <strong>{string.short}</strong>
            <small>{string.frequency.toFixed(2)} Hz</small>
          </button>
        ))}
      </div>

      <div className="quick-tuner-readout">
        <div className="target-string">
          <span>{complete ? "TUNING COMPLETE" : "TUNE THIS STRING"}</span>
          <strong>{complete ? "OK" : target.label}</strong>
          <small>{complete ? "All six strings are in tune" : `${target.frequency.toFixed(2)} Hz`}</small>
        </div>
        <div className="quick-meter">
          <div className="live-frequency">
            <span>Current frequency</span>
            <strong>{currentFrequency ? currentFrequency.toFixed(2) : "--"}<small> Hz</small></strong>
            <p>Target: {target.frequency.toFixed(2)} Hz</p>
          </div>
          <div className="quick-meter-labels"><span>FLAT</span><b>{!listening ? "INPUT OFF" : !currentFrequency ? "PLAY STRING" : inTune ? "IN TUNE" : centsFromTarget < 0 ? "TUNE UP" : "TUNE DOWN"}</b><span>SHARP</span></div>
          <div className="quick-meter-track">
            <i style={{ left: `${Math.max(0, Math.min(100, centsFromTarget + 50))}%` }} />
          </div>
          <output>{currentFrequency ? `${centsFromTarget > 0 ? "+" : ""}${centsFromTarget} cents from target` : "--"}</output>
          <div className="tuning-hold"><i style={{ width: `${(hold / REQUIRED_READINGS) * 100}%` }} /></div>
        </div>
      </div>
    </section>
  );
}
