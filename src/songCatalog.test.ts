import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { buildCatalog, parseSong } from "./songCatalog";

const songsDirectory = new URL("./songs/", import.meta.url);

async function loadSongs() {
  const files = (await readdir(songsDirectory)).filter((file) => file.endsWith(".json"));
  const documents = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await Bun.file(new URL(file, songsDirectory)).json()])));
  return { files, documents };
}

describe("song catalog", () => {
  test("contains exactly 30 valid, uniquely ordered songs", async () => {
    const { files, documents } = await loadSongs();
    const catalog = buildCatalog(documents);
    const songs = catalog.flatMap((level) => level.categories.flatMap((category) => category.progressions));
    expect(files).toHaveLength(30);
    expect(songs).toHaveLength(30);
    expect(new Set(songs.map((song) => song.id)).size).toBe(30);
    expect(catalog.map((level) => [level.id, level.categories.flatMap((category) => category.progressions).map((song) => song.id)])).toEqual([
      ["beginner", ["knockin-heavens-door", "zombie", "smoke-on-the-water", "mario-ground-simple", "zeldas-lullaby", "final-fantasy-victory-fanfare"]],
      ["rhythm-player", ["about-a-girl", "seven-nation-army", "sunshine-of-your-love", "iron-man", "tetris-theme", "lost-woods"]],
      ["band-ready", ["bad-moon-rising", "sweet-home-alabama", "californication", "day-tripper", "mario-ground-full", "megalovania"]],
      ["headliner", ["back-in-black", "hotel-california", "enter-sandman", "house-rising-sun", "crazy-train", "song-of-storms"]],
      ["rock-star", ["thunderstruck", "dont-fear-reaper", "sweet-child-o-mine", "at-dooms-gate", "gerudo-valley", "halo-theme"]],
    ]);
    for (const level of catalog) {
      for (const category of level.categories) {
        const orders = category.progressions.map((song) => song.order);
        expect(new Set(orders).size).toBe(orders.length);
      }
    }
    expect(songs.some((song) => song.id === "one-winged-angel")).toBe(false);
    expect(Object.fromEntries(songs.filter((song) => song.beatsPerBar !== 4).map((song) => [song.id, song.beatsPerBar]))).toEqual({
      "house-rising-sun": 3,
      "song-of-storms": 3,
      "zeldas-lullaby": 3,
    });

    const songBeats = (id: string) => songs.find((song) => song.id === id)!.steps.reduce((total, step) => total + step.beats, 0);
    const expectedBars = {
      "knockin-heavens-door": 4, zombie: 8, "smoke-on-the-water": 4, "mario-ground-simple": 3, "zeldas-lullaby": 4, "final-fantasy-victory-fanfare": 3,
      "about-a-girl": 2, "seven-nation-army": 2, "sunshine-of-your-love": 2, "iron-man": 4, "tetris-theme": 4, "lost-woods": 4,
      "bad-moon-rising": 4, "sweet-home-alabama": 2, californication: 4, "day-tripper": 2, "mario-ground-full": 3, megalovania: 8,
      "back-in-black": 4, "hotel-california": 8, "enter-sandman": 2, "house-rising-sun": 4, "crazy-train": 2, "song-of-storms": 8,
      thunderstruck: 2, "dont-fear-reaper": 2, "sweet-child-o-mine": 4, "at-dooms-gate": 1, "gerudo-valley": 4, "halo-theme": 3,
    };
    expect(Object.fromEntries(songs.map((song) => [song.id, Math.round(songBeats(song.id) / song.beatsPerBar)]))).toEqual(expectedBars);

    const gerudoNotes = songs.find((song) => song.id === "gerudo-valley")!.steps.filter((step) => step.type === "note");
    expect(gerudoNotes.slice(0, 4).map((step) => step.note)).toEqual(["C#", "F#", "G#", "A"]);
    const noteNames = (id: string) => songs.find((song) => song.id === id)!.steps.filter((step) => step.type === "note").map((step) => step.note);
    expect(noteNames("dont-fear-reaper")).toEqual(["A", "E", "A", "C", "G", "D", "G", "B", "F", "F", "A", "C", "G", "D", "G", "B"]);
    expect(noteNames("megalovania").filter((_, index) => [2, 12, 22, 32].includes(index))).toEqual(["D", "D", "D", "D"]);
    const ironMan = songs.find((song) => song.id === "iron-man")!;
    expect(ironMan.recommendedBpm).toBe(155);
    expect(songBeats("iron-man")).toBe(16);
    for (const id of ["californication", "day-tripper", "sweet-home-alabama"]) {
      expect(songs.find((song) => song.id === id)!.steps.at(-1)?.type).toBe("note");
    }
  });

  test("requires a positive integer beatsPerBar", () => {
    const song = { id: "meter", name: "Meter", difficulty: "beginner", category: "rock", order: 1, recommendedBpm: 80, steps: [{ type: "mute", beats: 1 }] };
    expect(() => parseSong(song, "meter.json")).toThrow("Invalid song JSON meter.json: beatsPerBar must be a positive integer");
    expect(() => parseSong({ ...song, beatsPerBar: 3.5 }, "meter.json")).toThrow("Invalid song JSON meter.json: beatsPerBar must be a positive integer");
  });

  test("accepts mute and rejects rest", () => {
    const song = { id: "silence", name: "Silence", difficulty: "beginner", category: "rock", order: 1, recommendedBpm: 80, beatsPerBar: 4, steps: [{ type: "mute", beats: 4 }] };
    expect(parseSong(song, "silence.json").steps[0]).toEqual({ type: "mute", beats: 4 });
    expect(() => parseSong({ ...song, steps: [{ type: "rest", beats: 4 }] }, "silence.json"))
      .toThrow("Invalid song JSON silence.json: step 1 has unknown type rest");
  });

  test("rejects step totals that do not complete a bar", () => {
    const song = { id: "partial", name: "Partial", difficulty: "beginner", category: "rock", order: 1, recommendedBpm: 80, beatsPerBar: 4, steps: [{ type: "mute", beats: 3.5 }] };
    expect(() => parseSong(song, "partial.json"))
      .toThrow("Invalid song JSON partial.json: step beats total 3.5 does not resolve to complete 4-beat bars");
  });

  test("rejects malformed mute durations with a clear source", () => {
    expect(() => parseSong({ id: "bad", name: "Bad", difficulty: "beginner", category: "rock", order: 1, recommendedBpm: 80, beatsPerBar: 4, steps: [{ type: "mute", beats: 0 }] }, "bad.json"))
      .toThrow("Invalid song JSON bad.json: step 1 beats must be positive");
  });

  test("rejects notes that do not match their guitar position", () => {
    const song = { id: "pitch", name: "Pitch", difficulty: "beginner", category: "rock", order: 1, recommendedBpm: 80, beatsPerBar: 4, steps: [{ type: "note", note: "F", octave: 4, string: 0, fret: 0, finger: "", beats: 4 }] };
    expect(() => parseSong(song, "pitch.json"))
      .toThrow("Invalid song JSON pitch.json: step 1 F4 does not match string 0 fret 0");
  });
});
