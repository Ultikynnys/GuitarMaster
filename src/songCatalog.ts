export const DIFFICULTIES = [
  { id: "beginner", name: "Beginner" },
  { id: "rhythm-player", name: "Rhythm Player" },
  { id: "band-ready", name: "Band Ready" },
  { id: "headliner", name: "Headliner" },
  { id: "rock-star", name: "Rock Star" },
] as const;

export const CATEGORIES = [
  { id: "rock", name: "Rock" },
  { id: "video-games", name: "Video Games" },
] as const;

export type DifficultyId = typeof DIFFICULTIES[number]["id"];
export type CategoryId = typeof CATEGORIES[number]["id"];
export type NoteStep = { type: "note"; note: string; octave: number; string: number; fret: number; finger: string; beats: number; muted?: boolean };
export type ChordStep = { type: "chord"; chord: string; beats: number; muted?: boolean };
export type ProgressionStep = NoteStep | ChordStep;
export type Progression = {
  id: string;
  name: string;
  difficulty: DifficultyId;
  category: CategoryId;
  order: number;
  recommendedBpm: number;
  beatsPerBar: number;
  steps: ProgressionStep[];
};
export type MusicCategory = { id: CategoryId; name: string; progressions: Progression[] };
export type DifficultyLevel = { id: DifficultyId; name: string; categories: MusicCategory[] };

// Label for a step in the game UI. Muted steps are timed mutes — the player
// damps the strings, no chord/note rings — so they are labelled "Mute" and
// NEVER "Em (muted)": combining a chord name with a mute is unplayable and
// confusing.
export function stepLabel(step: ProgressionStep): string {
  if (step.muted) return "Mute";
  if (step.type === "chord") return step.chord;
  return `${step.note} ${step.octave}`;
}

const NOTE_NAMES = new Set(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]);
const NOTE_OFFSETS: Record<string, number> = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
const OPEN_STRING_MIDI = [64, 59, 55, 50, 45, 40];
const CHORD_NAMES = new Set(["A", "Am", "C", "D", "Dm", "E", "Em", "F", "G"]);
const DIFFICULTY_IDS = new Set<string>(DIFFICULTIES.map(({ id }) => id));
const CATEGORY_IDS = new Set<string>(CATEGORIES.map(({ id }) => id));

function fail(source: string, message: string): never {
  throw new Error(`Invalid song JSON ${source}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSong(value: unknown, source = "<unknown>"): Progression {
  if (!isRecord(value)) fail(source, "expected an object");
  if (typeof value.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) fail(source, "id must be a non-empty kebab-case string");
  if (typeof value.name !== "string" || value.name.trim() === "") fail(source, "name must be non-empty");
  if (typeof value.difficulty !== "string" || !DIFFICULTY_IDS.has(value.difficulty)) fail(source, `unknown difficulty ${String(value.difficulty)}`);
  if (typeof value.category !== "string" || !CATEGORY_IDS.has(value.category)) fail(source, `unknown category ${String(value.category)}`);
  if (!Number.isInteger(value.order) || (value.order as number) <= 0) fail(source, "order must be a positive integer");
  if (typeof value.recommendedBpm !== "number" || !Number.isFinite(value.recommendedBpm) || value.recommendedBpm <= 0) fail(source, "recommendedBpm must be positive");
  if (!Number.isInteger(value.beatsPerBar) || (value.beatsPerBar as number) <= 0) fail(source, "beatsPerBar must be a positive integer");
  if (!Array.isArray(value.steps) || value.steps.length === 0) fail(source, "steps must be a non-empty array");

  value.steps.forEach((step, index) => {
    const location = `step ${index + 1}`;
    if (!isRecord(step)) fail(source, `${location} must be an object`);
    if (typeof step.beats !== "number" || !Number.isFinite(step.beats) || step.beats <= 0) fail(source, `${location} beats must be positive`);
    if (step.type === "chord") {
      if (typeof step.chord !== "string" || !CHORD_NAMES.has(step.chord)) fail(source, `${location} has unknown chord ${String(step.chord)}`);
      return;
    }
    if (step.type !== "note") fail(source, `${location} has unknown type ${String(step.type)}`);
    if (typeof step.note !== "string" || !NOTE_NAMES.has(step.note)) fail(source, `${location} has invalid note ${String(step.note)}`);
    if (!Number.isInteger(step.octave) || (step.octave as number) < 0 || (step.octave as number) > 8) fail(source, `${location} octave must be an integer from 0 to 8`);
    if (!Number.isInteger(step.string) || (step.string as number) < 0 || (step.string as number) > 5) fail(source, `${location} string must be an integer from 0 to 5`);
    if (!Number.isInteger(step.fret) || (step.fret as number) < 0 || (step.fret as number) > 24) fail(source, `${location} fret must be an integer from 0 to 24`);
    const writtenMidi = ((step.octave as number) + 1) * 12 + NOTE_OFFSETS[step.note as string];
    const frettedMidi = OPEN_STRING_MIDI[step.string as number] + (step.fret as number);
    if (writtenMidi !== frettedMidi) fail(source, `${location} ${String(step.note)}${String(step.octave)} does not match string ${String(step.string)} fret ${String(step.fret)}`);
    const validFinger = step.fret === 0 ? step.finger === "" : typeof step.finger === "string" && /^[1-4]$/.test(step.finger);
    if (!validFinger) fail(source, `${location} finger must be empty for an open string or 1 through 4 for a fretted note`);
  });

  const totalBeats = value.steps.reduce((total, step) => total + (step as Record<string, number>).beats, 0);
  const barCount = totalBeats / (value.beatsPerBar as number);
  if (Math.abs(barCount - Math.round(barCount)) > 1e-9) {
    fail(source, `step beats total ${totalBeats} does not resolve to complete ${String(value.beatsPerBar)}-beat bars`);
  }

  return value as Progression;
}

export function buildCatalog(documents: Record<string, unknown>): DifficultyLevel[] {
  const ids = new Set<string>();
  const songs = Object.entries(documents).map(([source, module]) => {
    const raw = isRecord(module) && "default" in module ? module.default : module;
    const song = parseSong(raw, source);
    if (ids.has(song.id)) fail(source, `duplicate id ${song.id}`);
    ids.add(song.id);
    return song;
  });

  const catalog = DIFFICULTIES.map((difficulty) => ({
    ...difficulty,
    categories: CATEGORIES.map((category) => ({
      ...category,
      progressions: songs
        .filter((song) => song.difficulty === difficulty.id && song.category === category.id)
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
    })).filter((category) => category.progressions.length > 0),
  }));

  for (const level of catalog) {
    const songCount = level.categories.reduce((total, category) => total + category.progressions.length, 0);
    if (songCount < 6) fail("catalog", `${level.name} must contain at least 6 songs`);
    if (level.categories.length !== CATEGORIES.length) fail("catalog", `${level.name} must contain songs from every category`);
  }

  return catalog;
}
