import { describe, expect, test } from "bun:test";
import { detectPitch, frequencyToPitch } from "./audioDetection";

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
