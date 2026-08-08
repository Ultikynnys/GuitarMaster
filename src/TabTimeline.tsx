import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { ProgressionStep } from "./songCatalog";
import { CHORDS } from "./chords";

const STRING_NAMES = ["e", "B", "G", "D", "A", "E"]; // index 0 = high e (top row)
const TOP_PAD = 72;
const BOTTOM_PAD = 40;
const LEFT_PAD = 8;
const RIGHT_PAD = 60;
const MAX_PX_PER_BEAT = 48;
const MIN_PX_PER_BEAT = 18;
const BAR_HEIGHT = 34;
const ROW_GAP = 12;
/** Row pitch is driven by the bar height so strings stay close together. */
const ROW_HEIGHT = BAR_HEIGHT + ROW_GAP;
const NUM_OFFSET = 8;

function rowY(string: number): number {
  return TOP_PAD + string * ROW_HEIGHT + ROW_HEIGHT / 2;
}

// Primary colors (red, yellow, blue) cycled by fret number: adjacent frets
// always differ and the palette repeats every three frets up the neck.
const PRIMARY_HUES = [0, 60, 240];

function fretHue(fret: number): number {
  return PRIMARY_HUES[fret % PRIMARY_HUES.length];
}

/**
 * Full tab notation plotted against time. Each string is a horizontal row
 * (high e on top, like written tab); every step is drawn as a bar spanning
 * its written length, with the fret number at the bar's left edge. The
 * active step's bars are highlighted and the container auto-scrolls to
 * keep them in view.
 */
export default function TabTimeline({ steps, activeIndex, beatsPerBar, saturation }: {
  steps: ProgressionStep[];
  activeIndex: number;
  beatsPerBar: number;
  saturation: number;
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
      // Run the lines up through the chord-label row so labels sit on the grid.
      <line key={`g-${beat}`} className={isBar ? "tl-bar-line" : "tl-beat-line"} x1={x} y1={TOP_PAD - 50} x2={x} y2={rowY(STRING_NAMES.length - 1)} />,
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
          <rect className={barCls} x={startX} y={rowY(step.string) - BAR_HEIGHT / 2} width={width} height={BAR_HEIGHT} rx={3} style={{ "--bar-hue": fretHue(step.fret) } as CSSProperties} />
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
        <rect key={`${index}-${string}-bar`} className={barCls} x={startX} y={rowY(string) - BAR_HEIGHT / 2} width={width} height={BAR_HEIGHT} rx={3} style={{ "--bar-hue": fretHue(Number(fret)) } as CSSProperties} />,
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
    <div className="tab-timeline-wrap">
      <div className="tab-timeline-legend" style={{ height }} aria-hidden="true">
        <div className="tab-legend-time" style={{ height: TOP_PAD - ROW_HEIGHT / 2 - 4 }}>{beatsPerBar}/4</div>
        {STRING_NAMES.map((name) => (
          <div key={name} className="tab-legend-string" style={{ height: ROW_HEIGHT }}>{name}</div>
        ))}
      </div>
      <div className="tab-timeline-scroll" ref={wrapRef}>
        <svg
          className="tab-timeline"
          width={width}
          height={height}
          fontSize={fontSize}
          style={{ "--bar-sat": `${Math.round(saturation * 100)}%` } as CSSProperties}
          role="img"
          aria-label="Tab notation plotted against time"
        >
          {grid}
          {STRING_NAMES.map((name, string) => (
            <g key={name}>
              <line className="tl-string" x1={LEFT_PAD} y1={rowY(string)} x2={width - RIGHT_PAD} y2={rowY(string)} />
            </g>
          ))}
          {marks}
        </svg>
      </div>
    </div>
  );
}
