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
/** Minimum bar width and fret-number size so numbers always fit inside. */
const MIN_BAR_WIDTH = 10;
const MIN_NUM_FONT = 8;
const BAR_HEIGHT = 46;
/** Bars fill their lane edge-to-edge: pitch equals bar height, so the
 * string lanes pack vertically with no gaps between strings. */
const ROW_HEIGHT = BAR_HEIGHT;
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

// Global chord label palette, keyed by root note so it is future-proof:
// every chord name starts with a root, so any chord that gets added to the
// catalog (E7, F#m, Bb, C/G, ...) resolves to a color without a per-chord
// entry. Both sharp and flat spellings map to the same semitone, and the
// cycle repeats every three semitones through the primary hues.
const ROOT_SEMITONES: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4,
  F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

function chordHue(chord: string): number {
  const root = chord.match(/^[A-G][#b]?/)?.[0] ?? "C";
  const semitone = ROOT_SEMITONES[root] ?? 0;
  return PRIMARY_HUES[semitone % PRIMARY_HUES.length];
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
      <line key={`g-${beat}`} className={isBar ? "tl-bar-line" : "tl-beat-line"} x1={x} y1={TOP_PAD - 68} x2={x} y2={rowY(STRING_NAMES.length - 1) + ROW_HEIGHT / 2} />,
    );
    if (isBar && beat < totalBeats) {
      grid.push(<text key={`bar-${beat}`} className="tl-bar-num" x={x + 3} y={TOP_PAD - 30}>{beat / beatsPerBar + 1}</text>);
    }
  }

  const marks = steps.map((step, index) => {
    const startX = LEFT_PAD + offsets[index] * pxPerBeat;
    const width = Math.max(MIN_BAR_WIDTH, step.beats * pxPerBeat);
    const active = index === activeIndex;
    const barCls = active ? "tl-bar active" : "tl-bar";
    const numCls = active ? "tl-fret active" : "tl-fret";
    // Fret numbers are centered inside their bar; glyphs shrink for short
    // bars so they always fit.
    const numFont = Math.min(fontSize, Math.max(MIN_NUM_FONT, width - 4));
    const numberX = (digits: number) => {
      const numberWidth = numFont * 0.6 * digits;
      return startX + Math.max(0, (width - numberWidth) / 2);
    };
    if (step.type === "note") {
      if (step.muted) {
        return (
          <g key={index}>
            <rect className={barCls} x={startX} y={rowY(step.string) - BAR_HEIGHT / 2} width={width} height={BAR_HEIGHT} rx={3} />
            <text className="tl-mute" x={startX + width / 2} y={rowY(step.string)} dominantBaseline="central">x</text>
          </g>
        );
      }
      const noteBarCls = step.fret === 0 ? `${barCls} open` : barCls;
      const noteNumCls = step.fret === 0 ? `${numCls} open` : numCls;
      return (
        <g key={index}>
          <rect className={noteBarCls} x={startX} y={rowY(step.string) - BAR_HEIGHT / 2} width={width} height={BAR_HEIGHT} rx={3} style={{ "--bar-hue": fretHue(step.fret) } as CSSProperties} />
          <text className={noteNumCls} x={numberX(String(step.fret).length)} y={rowY(step.string)} dominantBaseline="central" fontSize={numFont}>{step.fret}</text>
        </g>
      );
    }
    const shape = CHORDS[step.chord];
    const frets = shape.frets.flatMap((fret, string) => {
      if (fret === "" || fret === "x") return []; // unplayed string: no mark
      if (step.muted) {
        return [
          <rect key={`${index}-${string}-bar`} className={barCls} x={startX} y={rowY(string) - BAR_HEIGHT / 2} width={width} height={BAR_HEIGHT} rx={3} />,
          <text key={`${index}-${string}`} className="tl-mute" x={startX + width / 2} y={rowY(string)} dominantBaseline="central">x</text>,
        ];
      }
      const isOpen = fret === "0";
      return [
        <rect key={`${index}-${string}-bar`} className={isOpen ? `${barCls} open` : barCls} x={startX} y={rowY(string) - BAR_HEIGHT / 2} width={width} height={BAR_HEIGHT} rx={3} style={{ "--bar-hue": fretHue(Number(fret)) } as CSSProperties} />,
        <text key={`${index}-${string}`} className={isOpen ? `${numCls} open` : numCls} x={numberX(fret.length)} y={rowY(string)} dominantBaseline="central" fontSize={numFont}>{fret}</text>,
      ];
    });
    return (
      <g key={index}>
        {!step.muted && <text className="tl-chord-label" x={startX + width / 2} y={TOP_PAD - 52} style={{ "--chord-hue": chordHue(step.chord) } as CSSProperties}>{step.chord}</text>}
        {frets}
      </g>
    );
  });

  return (
    <div className="tab-timeline-wrap">
      <div className="tab-timeline-legend" style={{ height }} aria-hidden="true">
        {/* Time block height = laneTop(0) = TOP_PAD, so the label rows below
            start exactly where the SVG string lanes start. */}
        <div className="tab-legend-time" style={{ height: TOP_PAD }}>{beatsPerBar}/4</div>
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
          {Array.from({ length: STRING_NAMES.length + 1 }, (_, line) => (
            <g key={line}>
              {/* One line per lane boundary (7 for 6 strings), so the high-e
                  row gets a line above it and the low-E row one below. */}
              <line className="tl-string" x1={LEFT_PAD} y1={rowY(line) - ROW_HEIGHT / 2} x2={width - RIGHT_PAD} y2={rowY(line) - ROW_HEIGHT / 2} />
            </g>
          ))}
          {marks}
        </svg>
      </div>
    </div>
  );
}
