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
  const pitchClasses = new Array<number>(12).fill(0);
  let total = 0;

  for (let bin = 1; bin < spectrum.length; bin++) {
    const frequency = (bin * sampleRate) / fftSize;
    if (frequency < 70 || frequency > 2500) continue;
    const db = spectrum[bin];
    if (!Number.isFinite(db) || db < -85) continue;
    const amplitude = 10 ** (db / 20) / (frequency / 70) ** 0.3;
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    pitchClasses[((midi % 12) + 12) % 12] += amplitude;
    total += amplitude;
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
