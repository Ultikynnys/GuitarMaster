const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11,
};

function noteToMidi(name: string): number {
  const match = name.match(/^([A-G][s]?)(\d)$/);
  if (!match) throw new Error(`Invalid note name: ${name}`);
  const octave = Number(match[2]);
  return (octave + 1) * 12 + NOTE_TO_SEMITONE[match[1]];
}

function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

const SAMPLE_DIR = "./samples/guitar/";

const SAMPLE_NOTES = [
  "A2", "As2", "B2",
  "C3", "Cs3", "D3", "Ds3", "E3", "F3", "Fs3", "G3", "Gs3", "A3", "As3", "B3",
  "C4", "Cs4", "D4", "Ds4", "E4", "F4", "Fs4", "G4",
];

export type SampleEntry = { buffer: AudioBuffer; normGain: number };
export type SampleMap = Map<number, SampleEntry>; // midiNote → entry

let sampleMidiList: number[] | null = null;

export async function loadSamples(ctx: AudioContext): Promise<SampleMap> {
  const map: SampleMap = new Map();

  const results = await Promise.all(
    SAMPLE_NOTES.map(async (note) => {
      try {
        const response = await fetch(SAMPLE_DIR + note + ".mp3");
        if (!response.ok) {
          console.warn(`sampleEngine: failed to fetch ${note} (${response.status})`);
          return null;
        }
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        return { midi: noteToMidi(note), buffer: audioBuffer } as const;
      } catch (err) {
        console.warn(`sampleEngine: error loading ${note}:`, err);
        return null;
      }
    }),
  );

  for (const r of results) {
    if (r) map.set(r.midi, { buffer: r.buffer, normGain: 1 });
  }

  // Normalize by RMS energy over the first 500ms — peak amplitude is
  // meaningless if the sample has a loud transient but no sustain.
  // Every other step in the fanfare (G#4, A#4, C5) uses the G4 sample;
  // C4 uses its own much quieter sample. RMS normalization fixes that.
  if (map.size > 0) {
    let maxRms = 0;
    const rmsValues = new Map<number, number>();
    for (const [midi, entry] of map) {
      const data = entry.buffer.getChannelData(0);
      const sampleRate = entry.buffer.sampleRate;
      const windowSamples = Math.min(data.length, Math.ceil(sampleRate * 0.5));
      let sumSq = 0;
      for (let i = 0; i < windowSamples; i++) {
        sumSq += data[i] * data[i];
      }
      const rms = Math.sqrt(sumSq / windowSamples);
      rmsValues.set(midi, rms);
      if (rms > maxRms) maxRms = rms;
    }
    if (maxRms > 0) {
      for (const [midi, rms] of rmsValues) {
        const entry = map.get(midi)!;
        entry.normGain = Math.min(3, maxRms / rms);
      }
    }
  }

  // Cache sorted MIDI list for findBestSample
  sampleMidiList = [...map.keys()].sort((a, b) => a - b);

  return map;
}

function findBestSample(midiNote: number, samples: SampleMap): { entry: SampleEntry; sampleMidi: number } | null {
  if (!sampleMidiList || sampleMidiList.length === 0) return null;

  let best = sampleMidiList[0];
  let bestDist = Math.abs(midiNote - best);
  for (const m of sampleMidiList) {
    const dist = Math.abs(midiNote - m);
    if (dist < bestDist) {
      bestDist = dist;
      best = m;
    }
  }

  return { entry: samples.get(best)!, sampleMidi: best };
}

export function playSample(
  frequency: number,
  startTime: number,
  volume: number,
  duration: number,
  ctx: AudioContext,
  samples: SampleMap,
  sourceTracker?: Set<AudioBufferSourceNode>,
  attackSec?: number,
): AudioBufferSourceNode | null {
  const attack = attackSec ?? 0.008;
  // Use Math.log / Math.LN2 instead of Math.log2 — same result, more widely hardened.
  const targetMidi = 69 + 12 * (Math.log(frequency / 440) / Math.LN2);
  const midiRounded = Math.round(targetMidi);
  if (!Number.isFinite(midiRounded) || midiRounded < 0 || midiRounded > 127) return null;

  let best = findBestSample(midiRounded, samples);

  // Fallback: if the exact sample is missing, use any available sample
  if (!best) {
    if (samples.size === 0) {
      console.warn("sampleEngine: no samples loaded, cannot play note");
      return null;
    }
    const anyMidi = [...samples.keys()][0];
    best = { entry: samples.get(anyMidi)!, sampleMidi: anyMidi };
    console.warn(`sampleEngine: no sample near MIDI ${midiRounded}, falling back to MIDI ${anyMidi}`);
  }

  const sampleFreq = midiToFreq(best.sampleMidi);
  const normalizedVolume = volume * best.entry.normGain;
  let playbackRate = frequency / sampleFreq;
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) playbackRate = 1;

  // Clamp startTime so we never schedule in the past (e.g. setTimeout drift).
  const now = ctx.currentTime;
  if (startTime < now) {
    const drift = now - startTime;
    startTime = now;
    duration = Math.max(0, duration - drift);
  }

  const source = ctx.createBufferSource();
  const lowpass = ctx.createBiquadFilter();
  const bodyLow = ctx.createBiquadFilter();
  const bodyHigh = ctx.createBiquadFilter();
  const compressor = ctx.createDynamicsCompressor();
  const gain = ctx.createGain();

  source.buffer = best.entry.buffer;
  source.playbackRate.setValueAtTime(playbackRate, startTime);

  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(Math.min(1900, 1100 + frequency * 1.8), startTime);
  lowpass.Q.setValueAtTime(0.7, startTime);

  bodyLow.type = "peaking";
  bodyLow.frequency.setValueAtTime(210, startTime);
  bodyLow.Q.setValueAtTime(1.1, startTime);
  bodyLow.gain.setValueAtTime(6, startTime);

  bodyHigh.type = "peaking";
  bodyHigh.frequency.setValueAtTime(480, startTime);
  bodyHigh.Q.setValueAtTime(1.4, startTime);
  bodyHigh.gain.setValueAtTime(3, startTime);

  compressor.threshold.setValueAtTime(-20, startTime);
  compressor.knee.setValueAtTime(14, startTime);
  compressor.ratio.setValueAtTime(3, startTime);
  compressor.attack.setValueAtTime(0.004, startTime);
  compressor.release.setValueAtTime(0.12, startTime);

  gain.gain.setValueAtTime(attack > 0 ? 0.0001 : normalizedVolume, startTime);
  if (attack > 0) gain.gain.linearRampToValueAtTime(normalizedVolume, startTime + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  source.connect(lowpass);
  lowpass.connect(bodyLow);
  bodyLow.connect(bodyHigh);
  bodyHigh.connect(compressor);
  compressor.connect(gain);
  gain.connect(ctx.destination);

  if (sourceTracker) {
    sourceTracker.add(source);
    source.addEventListener("ended", () => sourceTracker.delete(source), { once: true });
  }

  source.start(startTime);
  source.stop(startTime + duration);

  return source;
}
