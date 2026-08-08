import { useEffect, useMemo, useRef } from "react";
import type { ProgressionStep } from "./songCatalog";
import { CHORDS } from "./chords";

const STRING_NAMES = ["e", "B", "G", "D", "A", "E"]; // index 0 = high e (top row)
const ROW_HEIGHT = 80;
const TOP_PAD = 72;
const BOTTOM_PAD = 40;
const LEFT_PAD = 30;
const RIGHT_PAD = 60;
const MAX_PX_PER_BEAT = 48;
const MIN_PX_PER_BEAT = 18;
const BAR_HEIGHT = 34;
const NUM_OFFSET = 8;

function rowY(string: number): number {
  return TOP_PAD + string * ROW_HEIGHT + ROW_HEIGHT / 2;
}

/**
 * Full tab notation plotted against time. Each string is a horizontal row
 * (high e on top, like written tab); every step is drawn as a bar spanning
 * its written length, with the fret number at the bar's left edge. The
 * active step's bars are highlighted and the container auto-scrolls to
 * keep them in view.
 */
export default function TabTimeline({ steps, activeIndex, beatsPerBar }: {
  steps: ProgressionStep[];
  activeIndex: number;
  beatsPerBar: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  const offsets = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const step of steps) {
      out.push(acc);
      acc += step.beats;
    }
    return out;
  }, [steps]);

  // Scale time so the shortest step still gets a readable slot; cap total
  // width so very long songs stay manageable.
  const minBeats = Math.min(...steps.map((step) => step.beats));
  const pxPerBeat = Math.max(MIN_PX_PER_BEAT, Math.min(MAX_PX_PER_BEAT, 18 / minBeats));
  const fontSize = pxPerBeat >= 30 ? 24 : 18;
  const totalBeats = offsets[offsets.length - 1] + steps[steps.length - 1].beats;
  const width = LEFT_PAD + totalBeats * pxPerBeat + RIGHT_PAD;
  const height = TOP_PAD + STRING_NAMES.length * ROW_HEIGHT + BOTTOM_PAD;
  const activeX = activeIndex >= 0 && activeIndex < steps.length
    ? LEFT_PAD + offsets[activeIndex] * pxPerBeat
    : 0;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    wrap.scrollTo({ left: Math.max(0, activeX - wrap.clientWidth * 0.25), behavior: "smooth" });
  }, [activeX]);

  const grid = [];
  for (let beat = 0; beat <= Math.floor(totalBeats + 1e-9); beat += 1) {
    const x = LEFT_PAD + beat * pxPerBeat;
    const isBar = beat % beatsPerBar === 0;
    grid.push(
      <line key={`g-${beat}`} className={isBar ? "tl-bar-line" : "tl-beat-line"} x1={x} y1={rowY(0)} x2={x} y2={rowY(STRING_NAMES.length - 1)} />,
    );
    if (isBar && beat < totalBeats) {
      grid.push(<text key={`bar-${beat}`} className="tl-bar-num" x={x + 3} y={TOP_PAD - 8}>{beat / beatsPerBar + 1}</text>);
    }
  }

  const marks = steps.map((step, index) => {
    const startX = LEFT_PAD + offsets[index] * pxPerBeat;
    const width = Math.max(4, step.beats * pxPerBeat);
    const numX = startX + NUM_OFFSET;
    const active = index === activeIndex;
    const barCls = active ? "tl-bar active" : "tl-bar";
    const numCls = active ? "tl-fret active" : "tl-fret";
    if (step.type === "note") {
      if (step.muted) {
        return <text key={index} className="tl-mute" x={startX + width / 2} y={rowY(step.string)} dominantBaseline="central">x</text>;
      }
      return (
        <g key={index}>
          <rect className={barCls} x={startX} y={rowY(step.string) - BAR_HEIGHT / 2} width={width} height={BAR_HEIGHT} rx={3} />
          <text className={numCls} x={numX} y={rowY(step.string)} dominantBaseline="central">{step.fret}</text>
        </g>
      );
    }
    const shape = CHORDS[step.chord];
    const frets = shape.frets.flatMap((fret, string) => {
      if (fret === "" || fret === "x") return []; // unplayed string: no mark
      if (step.muted) {
        return [<text key={`${index}-${string}`} className="tl-mute" x={startX + width / 2} y={rowY(string)} dominantBaseline="central">x</text>];
      }
      return [
        <rect key={`${index}-${string}-bar`} className={barCls} x={startX} y={rowY(string) - BAR_HEIGHT / 2} width={width} height={BAR_HEIGHT} rx={3} />,
        <text key={`${index}-${string}`} className={numCls} x={numX} y={rowY(string)} dominantBaseline="central">{fret}</text>,
      ];
    });
    return (
      <g key={index}>
        {!step.muted && <text className="tl-chord-label" x={numX} y={TOP_PAD - 26}>{step.chord}</text>}
        {frets}
      </g>
    );
  });

  return (
    <div className="tab-timeline-wrap" ref={wrapRef}>
      <svg
        className="tab-timeline"
        width={width}
        height={height}
        fontSize={fontSize}
        role="img"
        aria-label="Tab notation plotted against time"
      >
        {grid}
        {STRING_NAMES.map((name, string) => (
          <g key={name}>
            <line className="tl-string" x1={LEFT_PAD} y1={rowY(string)} x2={width - RIGHT_PAD} y2={rowY(string)} />
            <text className="tl-string-name" x={LEFT_PAD - 8} y={rowY(string)} dominantBaseline="central">{name}</text>
          </g>
        ))}
        {marks}
      </svg>
    </div>
  );
}
