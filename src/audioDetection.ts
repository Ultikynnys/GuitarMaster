export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export type PitchResult = {
  note: string;
  octave: number;
  frequency: number;
  cents: number;
  confidence: number;
};

export type ChordResult = {
  name: string;
  notes: string[];
  confidence: number;
};

export function frequencyToPitch(frequency: number): PitchResult {
  const midi = 69 + 12 * Math.log2(frequency / 440);
  const rounded = Math.round(midi);
  return {
    note: NOTE_NAMES[((rounded % 12) + 12) % 12],
    octave: Math.floor(rounded / 12) - 1,
    frequency,
    cents: Math.round((midi - rounded) * 100),
    confidence: 1,
  };
}

export function detectPitch(samples: Float32Array, sampleRate: number): PitchResult | null {
  let energy = 0;
  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;
  for (const sample of samples) energy += (sample - mean) ** 2;
  const rms = Math.sqrt(energy / samples.length);
  if (rms < 0.008) return null;

  const minLag = Math.floor(sampleRate / 1200);
  const analysisLength = Math.min(samples.length, 8192);
  const maxLag = Math.min(Math.floor(sampleRate / 65), Math.floor(analysisLength / 2));
  const comparisonLength = analysisLength - maxLag;
  const difference = new Float32Array(maxLag + 1);
  const normalized = new Float32Array(maxLag + 1);

  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let index = 0; index < comparisonLength; index += 2) {
      const delta = samples[index] - samples[index + lag];
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  let runningSum = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    runningSum += difference[lag];
    normalized[lag] = runningSum === 0 ? 1 : difference[lag] * lag / runningSum;
  }

  // The first strong valley represents the shortest true period and avoids E2/E4 octave swaps.
  let bestLag = -1;
  for (let lag = minLag; lag < maxLag; lag++) {
    if (normalized[lag] < 0.18) {
      while (lag + 1 < maxLag && normalized[lag + 1] < normalized[lag]) lag++;
      bestLag = lag;
      break;
    }
  }
  if (bestLag < 0) {
    let bestValue = 1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (normalized[lag] < bestValue) {
        bestValue = normalized[lag];
        bestLag = lag;
      }
    }
    if (bestValue > 0.32) return null;
  }

  const before = normalized[Math.max(1, bestLag - 1)];
  const center = normalized[bestLag];
  const after = normalized[Math.min(maxLag, bestLag + 1)];
  const denominator = before - 2 * center + after;
  const offset = denominator === 0 ? 0 : 0.5 * (before - after) / denominator;
  const result = frequencyToPitch(sampleRate / (bestLag + Math.max(-0.5, Math.min(0.5, offset))));
  result.confidence = Math.max(0, 1 - center);
  return result;
}

export function detectChord(spectrum: Float32Array, sampleRate: number, fftSize: number): ChordResult | null {
  const firstBin = Math.max(1, Math.ceil((70 * fftSize) / sampleRate));
  const lastBin = Math.min(spectrum.length - 1, Math.floor((2500 * fftSize) / sampleRate));

  // Convert dB bins to linear amplitude and find the loudest bin in the band.
  const amplitude = new Float32Array(lastBin + 1);
  let peak = 0;
  for (let bin = firstBin; bin <= lastBin; bin++) {
    const db = spectrum[bin];
    if (!Number.isFinite(db)) continue;
    const value = 10 ** (db / 20);
    amplitude[bin] = value;
    if (value > peak) peak = value;
  }
  // Absolute floor: ~-80 dBFS per bin in a 16k FFT is analyser/ADC hiss,
  // nothing musical lives below it. Relative floor: partials of a strummed
  // string stay within ~45 dB of the strongest bin.
  const floor = Math.max(peak * 10 ** (-45 / 20), 10 ** (-80 / 20));
  if (peak < floor) return null;

  // Accumulate pitch-class energy from spectral PEAKS only. A plucked
  // string's partials are local maxima, while room hiss and ADC noise
  // rarely are — summing every bin (the old behaviour) let ~900 noise
  // bins dwarf the ~40 partials, so the triad's share of `total` sank
  // below threshold and real chords were rejected on most frames.
  const pitchClasses = new Array<number>(12).fill(0);
  let total = 0;
  for (let bin = firstBin + 2; bin <= lastBin - 2; bin++) {
    const value = amplitude[bin];
    if (value < floor) continue;
    if (value < amplitude[bin - 2] || value < amplitude[bin - 1]) continue;
    if (value < amplitude[bin + 1] || value < amplitude[bin + 2]) continue;
    // Prominence gate: a real partial stands well above the local noise
    // between partials (bins ±4..±8), a hiss peak does not. This removes
    // the noise peaks that a plain local-maximum test lets through.
    const neighbours: number[] = [];
    for (let d = 4; d <= 8; d++) {
      if (bin - d >= firstBin) neighbours.push(amplitude[bin - d]);
      if (bin + d <= lastBin) neighbours.push(amplitude[bin + d]);
    }
    if (neighbours.length >= 4) {
      neighbours.sort((a, b) => a - b);
      const middle = neighbours.length >> 1;
      const median = neighbours.length % 2 === 1
        ? neighbours[middle]
        : (neighbours[middle - 1] + neighbours[middle]) / 2;
      if (value < median * 4) continue;
    }
    const frequency = (bin * sampleRate) / fftSize;
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    pitchClasses[((midi % 12) + 12) % 12] += value;
    total += value;
  }

  if (total < 0.002) return null;
  const qualities = [
    { suffix: "", intervals: [0, 4, 7] },
    { suffix: "m", intervals: [0, 3, 7] },
  ];
  let best = { score: 0, root: 0, quality: qualities[0] };
  let secondScore = 0;

  for (let root = 0; root < 12; root++) {
    for (const quality of qualities) {
      const included = quality.intervals.reduce(
        (sum, interval, index) => sum + pitchClasses[(root + interval) % 12] * (index === 0 ? 1.15 : 1),
        0,
      );
      const score = included / (total * 1.15);
      if (score > best.score) {
        secondScore = best.score;
        best = { score, root, quality };
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
  }

  const confidence = Math.min(1, best.score * 0.85 + Math.max(0, best.score - secondScore) * 1.0);
  if (best.score < 0.28 || confidence < 0.25) return null;
  return {
    name: `${NOTE_NAMES[best.root]}${best.quality.suffix}`,
    notes: best.quality.intervals.map((interval) => NOTE_NAMES[(best.root + interval) % 12]),
    confidence,
  };
}

export type AttackState = {
  /** Level of the previous frame, for rise detection. */
  prevLevel: number;
  /** Long-term average of the spectral flux (EMA). */
  fluxBaseline: number;
  /** Frames remaining before another attack can fire (~180 ms per frame). */
  cooldown: number;
  /** Startup frames to skip so the baselines settle. */
  warmup: number;
};

export function createAttackState(): AttackState {
  return { prevLevel: 0, fluxBaseline: 0, cooldown: 0, warmup: 2 };
}

// Onset detection for a fresh strum. A new strum is either:
//  - a fast level RISE over the previous frame — the ring itself only
//    decays, so a decaying chord never triggers this; or
//  - a broadband spectral transient (spectral flux), which still shows up
//    when the input level is saturated and cannot rise any further.
// `flux` is the mean positive dB change per FFT bin since the last frame.
export function detectAttack(level: number, flux: number, state: AttackState): { attack: boolean; state: AttackState } {
  let { prevLevel, fluxBaseline, cooldown, warmup } = state;
  fluxBaseline = fluxBaseline * 0.7 + flux * 0.3;
  let attack = false;
  if (cooldown > 0) {
    cooldown--;
  } else if (warmup > 0) {
    warmup--;
  } else {
    const levelRise = level > 0.05 && level > prevLevel * 1.18;
    const fluxSpike = flux > Math.max(fluxBaseline * 3, 0.02);
    attack = levelRise || fluxSpike;
    if (attack) cooldown = 2;
  }
  return { attack, state: { prevLevel: level, fluxBaseline, cooldown, warmup } };
}
