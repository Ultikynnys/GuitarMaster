import { describe, expect, test } from "bun:test";
import { detectChord, detectPitch, frequencyToPitch } from "./audioDetection";

// Build a dBFS FFT spectrum the way AnalyserNode.getFloatFrequencyData
// reports it: one bin per (fftSize / 2), partials smeared over ~3 bins
// (window main lobe), plus a per-bin noise floor.
function chordSpectrum(fundamentals: number[], noiseDb = -75, seedValue = 1): Float32Array {
  const sampleRate = 48_000;
  const fftSize = 16_384;
  const bins = fftSize / 2;
  const spectrum = new Float32Array(bins).fill(noiseDb);
  let seed = seedValue;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  for (let bin = 0; bin < bins; bin++) spectrum[bin] = noiseDb + rand() * 6;
  for (const fundamental of fundamentals) {
    for (let harmonic = 1; harmonic <= 8; harmonic++) {
      const frequency = fundamental * harmonic;
      if (frequency < 70 || frequency > 2500) continue;
      const bin = (frequency * fftSize) / sampleRate;
      const peakDb = -30 - 8 * Math.log2(harmonic);
      for (const [offset, gain] of [[-1, 0.3], [0, 1], [1, 0.3]] as const) {
        const index = Math.round(bin) + offset;
        if (index >= 0 && index < bins) {
          spectrum[index] = Math.max(spectrum[index], peakDb + 20 * Math.log10(gain));
        }
      }
    }
  }
  return spectrum;
}

// Open-chord string fundamentals (low E → high E).
const E_MAJOR = [82.41, 123.47, 164.81, 207.65, 246.94, 329.63];
const E_MINOR = [82.41, 123.47, 164.81, 196.0, 246.94, 329.63];
const G_MAJOR = [98.0, 123.47, 146.83, 196.0, 246.94, 392.0];

describe("frequencyToPitch", () => {
  test("maps concert A", () => {
    expect(frequencyToPitch(440)).toMatchObject({ note: "A", octave: 4, cents: 0 });
  });

  test("maps low guitar E", () => {
    expect(frequencyToPitch(82.41)).toMatchObject({ note: "E", octave: 2 });
  });
});

describe("detectPitch", () => {
  test("detects a clean sine wave", () => {
    const sampleRate = 48_000;
    const samples = Float32Array.from({ length: 8192 }, (_, index) => Math.sin(2 * Math.PI * 110 * index / sampleRate) * 0.5);
    const result = detectPitch(samples, sampleRate);
    expect(result?.note).toBe("A");
    expect(result?.octave).toBe(2);
    expect(result?.frequency).toBeWithin(109, 111);
  });

  test.each([
    [82.41, 2],
    [329.63, 4],
  ])("distinguishes %.2f Hz E octaves", (frequency, octave) => {
    const sampleRate = 48_000;
    const samples = Float32Array.from({ length: 8192 }, (_, index) => {
      const phase = 2 * Math.PI * frequency * index / sampleRate;
      return Math.sin(phase) * 0.38 + Math.sin(phase * 2) * 0.2 + Math.sin(phase * 3) * 0.1;
    });
    const result = detectPitch(samples, sampleRate);
    expect(result?.note).toBe("E");
    expect(result?.octave).toBe(octave);
    expect(result?.frequency).toBeWithin(frequency - 1, frequency + 1);
  });

  test("ignores silence", () => {
    expect(detectPitch(new Float32Array(8192), 48_000)).toBeNull();
  });
});

describe("detectChord", () => {
  test("detects E major over a -75 dB noise floor", () => {
    const result = detectChord(chordSpectrum(E_MAJOR), 48_000, 16_384);
    expect(result?.name).toBe("E");
    expect(result?.confidence).toBeGreaterThan(0.45);
  });

  test("detects E major at a loud -55 dB noise floor", () => {
    const result = detectChord(chordSpectrum(E_MAJOR, -55), 48_000, 16_384);
    expect(result?.name).toBe("E");
    // Must clear the game's 0.48 acceptance gate with headroom to spare.
    expect(result?.confidence).toBeGreaterThan(0.6);
  });

  test("distinguishes E minor from E major", () => {
    expect(detectChord(chordSpectrum(E_MINOR), 48_000, 16_384)?.name).toBe("Em");
  });

  test("detects G major", () => {
    expect(detectChord(chordSpectrum(G_MAJOR), 48_000, 16_384)?.name).toBe("G");
  });

  test("returns null on noise-only input", () => {
    expect(detectChord(chordSpectrum([], -70, 7), 48_000, 16_384)).toBeNull();
  });

  test("returns null on silence", () => {
    expect(detectChord(new Float32Array(8192).fill(-120), 48_000, 16_384)).toBeNull();
  });
});
