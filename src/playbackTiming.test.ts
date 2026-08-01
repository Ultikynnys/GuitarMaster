import { describe, expect, test } from "bun:test";
import { chordPluckTiming, stepDurationSeconds } from "./playbackTiming";

describe("autoplay timing", () => {
  test("uses the complete written duration for every step", () => {
    expect(stepDurationSeconds(0.25, 180)).toBeCloseTo(1 / 12);
    expect(stepDurationSeconds(2, 60)).toBe(2);
  });

  test("keeps every chord pluck inside short and long steps", () => {
    for (const slotDuration of [stepDurationSeconds(0.25, 180), stepDurationSeconds(2, 60)]) {
      for (let string = 0; string < 6; string++) {
        const timing = chordPluckTiming(string, slotDuration);
        expect(timing.delay).toBeGreaterThanOrEqual(0);
        expect(timing.duration).toBeGreaterThan(0);
        expect(timing.delay + timing.duration).toBeCloseTo(slotDuration);
      }
    }
  });
});
