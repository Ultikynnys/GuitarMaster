export function stepDurationSeconds(beats: number, bpm: number): number {
  return (60 / bpm) * beats;
}

export function chordPluckTiming(string: number, slotDuration: number): { delay: number; duration: number } {
  const strumSpread = Math.min(0.09, slotDuration * 0.35);
  const delay = ((5 - string) / 5) * strumSpread;
  return { delay, duration: slotDuration - delay };
}
