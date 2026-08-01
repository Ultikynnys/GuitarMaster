# GuitarMaster

GuitarMaster is a local-first browser guitar analyzer and practice app. It identifies the strongest note and tuning offset, recognizes supported major and minor chords, guides standard tuning with a quick tuner, and runs microphone-driven progression games.

## Windows Setup

Install [Bun](https://bun.sh/) in PowerShell if it is not already available:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

This project uses the Bun version declared in `package.json`. From the project directory:

```powershell
bun install
bun run dev
```

Open the local Vite URL. Audio capture works only on `localhost` or HTTPS.

## Audio Input

1. Connect the guitar through an audio interface or line input.
2. Select **Enable guitar input** and grant browser microphone permission. Permission is required before browsers expose complete device names and input lists.
3. Choose the interface under **Available inputs**. Changing the selection while listening reopens the selected device; **Refresh inputs** rescans while stopped.
4. Play a clean note or chord and keep the input level steady without clipping.

Pass-through monitoring is optional and has its own volume. Use headphones when it is enabled: monitoring through speakers can create loud acoustic feedback.

## Features

- **Note/chord analyzer:** Shows the strongest note, octave, frequency, cents offset, signal level, and supported major or minor chord with confidence.
- **Quick tuner:** Guides standard tuning from low E to high e, allows direct string selection, and advances after stable in-tune readings.
- **Progression game:** Accepts notes and chords from the live input in sequence, uses timed mute steps, and tracks score, loops, and elapsed time.
- **Catalog:** Organizes songs into Beginner, Rhythm Player, Band Ready, Headliner, and Rock Star difficulties, with Rock and Video Games categories.

## Tempo And Playback

Each song supplies a recommended BPM. The live tempo slider controls autoplay timing, timed mute steps, and the synced metronome from 50 to 180 BPM. Double-click the slider to restore the selected song's recommended BPM.

Autoplay previews the complete sequence and repeats until switched off. Autoplay and a live progression session are mutually exclusive: starting a session stops autoplay, and autoplay cannot be enabled during a session. The metronome follows the selected BPM and `beatsPerBar`, using a distinct beat-one accent. Metronome volume is separate from accepted-step feedback volume.

Accepted live notes and chords produce a tick. Completing a sequence also produces a delayed tock. Mute steps advance silently after their beat duration.

## Song Catalog

Every song is one JSON file in `src/songs/`; Vite imports the directory automatically. Files are validated and then grouped by difficulty and category.

```json
{
  "id": "practice-bar",
  "name": "Practice Bar",
  "difficulty": "beginner",
  "category": "rock",
  "order": 1,
  "recommendedBpm": 80,
  "beatsPerBar": 4,
  "steps": [
    {
      "type": "note",
      "note": "E",
      "octave": 4,
      "string": 0,
      "fret": 0,
      "finger": "",
      "beats": 1
    },
    { "type": "chord", "chord": "Am", "beats": 2 },
    { "type": "mute", "beats": 1 }
  ]
}
```

`beatsPerBar` is required and must be a positive integer. Step `beats` values are positive beat durations; steps should be arranged so each musical bar totals `beatsPerBar`. In autoplay, note and chord `beats` control how long the sound is sustained before the next step. In live mode, notes and chords advance after stable detection rather than waiting their full written duration, while a mute means silence/rest and advances after its timed beat duration.

Note string indexes run from highest to lowest pitch: `0` = high e, `1` = B, `2` = G, `3` = D, `4` = A, and `5` = low E. Open notes use fret `0` and an empty `finger`; fretted notes use finger `1` through `4`. Supported chord names are `A`, `Am`, `C`, `D`, `Dm`, `E`, `Em`, `F`, and `G`.

### Adding A Song

1. Add a kebab-cased `.json` file under `src/songs/` using a unique kebab-case `id` and a positive `order` within its difficulty and category.
2. Use one of the five difficulty IDs (`beginner`, `rhythm-player`, `band-ready`, `headliner`, `rock-star`) and either `rock` or `video-games` as the category.
3. Define `recommendedBpm`, required `beatsPerBar`, and at least one valid note, chord, or mute step. Check each bar's beat total.
4. Run the validation commands below. Catalog tests verify parsing, IDs, ordering, meter, and expected song inventory.

## Validation And Build

```powershell
bun run check
bun test
bun run build
```

`bun run check` type-checks without emitting files. Tests cover audio detection and the song catalog. `bun run build` writes the production site to `dist/`; use `bun run preview` to serve that build locally.

## Versioning And CI

Build versions use `0.1.<commit-count>`. Run `bun run version:current` to print the current value; Vite embeds it in the application footer. Full Git history is required for an accurate count.

GitHub Actions runs on Windows for pushes and pull requests to `main`, plus manual dispatches. It installs the locked Bun dependencies, resolves the commit-count version, type-checks, tests, and builds. Every run uploads `dist/` as a versioned `GuitarMaster-<version>` artifact. Non-pull-request runs also upload and deploy the same build to GitHub Pages.

## Privacy

Audio analysis runs locally in the browser through the Web Audio API. Guitar input is not recorded, uploaded, or persisted by GuitarMaster.
