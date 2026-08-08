export type ChordShape = {
  name: string;
  frets: [string, string, string, string, string, string];
  fingerNumbers: [string, string, string, string, string, string];
  /** Barre: one finger across strings `from..to` (tab order, index 0 = high e) at `fret`. */
  barre?: { fret: number; from: number; to: number };
};

export const CHORDS: Record<string, ChordShape> = {
  A: { name: "A major", frets: ["0", "2", "2", "2", "0", "x"], fingerNumbers: ["", "3", "2", "1", "", ""] },
  Am: { name: "A minor", frets: ["0", "1", "2", "2", "0", "x"], fingerNumbers: ["", "1", "3", "2", "", ""] },
  C: { name: "C major", frets: ["0", "1", "0", "2", "3", "x"], fingerNumbers: ["", "1", "", "2", "3", ""] },
  D: { name: "D major", frets: ["2", "3", "2", "0", "x", "x"], fingerNumbers: ["2", "3", "1", "", "", ""] },
  Dm: { name: "D minor", frets: ["1", "3", "2", "0", "x", "x"], fingerNumbers: ["1", "3", "2", "", "", ""] },
  E: { name: "E major", frets: ["0", "0", "1", "2", "2", "0"], fingerNumbers: ["", "", "1", "3", "2", ""] },
  Em: { name: "E minor", frets: ["0", "0", "0", "2", "2", "0"], fingerNumbers: ["", "", "", "3", "2", ""] },
  F: { name: "F major", frets: ["1", "1", "2", "3", "3", "1"], fingerNumbers: ["1", "1", "2", "4", "3", "1"], barre: { fret: 1, from: 0, to: 5 } },
  G: { name: "G major", frets: ["3", "0", "0", "0", "2", "3"], fingerNumbers: ["3", "", "", "", "1", "2"] },
};
