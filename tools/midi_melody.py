#!/usr/bin/env python3
"""Extract the top-line (melody) of a MIDI: at each quantized tick, the highest
sounding note across chosen channels. Prints note name + beat duration runs."""
import sys
sys.path.insert(0, 'tools')
from midi_parse import note_events, NOTE_NAMES
from collections import defaultdict

NOTE_OFFSETS = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}


def name(midi):
    return f"{NOTE_NAMES[midi % 12]}{(midi // 12) - 1}"


def extract(path, channels=None, min_pitch=48, max_pitch=96, grid=0.25, ignore_short=0.05):
    """grid in beats; returns list of (start_beat, dur_beats, midi_pitch)."""
    fmt, tracks = note_events(path)
    ppq = tracks[0]['ppq']
    events = []  # (tick, type, pitch, off_tick)
    for t in tracks:
        for start, dur, pitch, ch in t['notes']:
            if channels and ch not in channels:
                continue
            if pitch < min_pitch or pitch > max_pitch:
                continue
            if dur / ppq < ignore_short:
                continue
            events.append((start, start + dur, pitch, dur))
    events.sort()
    # active set sweep: at each start/end boundary, the highest active note wins
    active = []  # (pitch, end_tick, dur)
    boundary = sorted({e[0] for e in events} | {e[1] for e in events})
    bi = 0
    segs = []  # (start_tick, end_tick, pitch)
    while bi < len(boundary):
        cur = boundary[bi]
        # remove ended
        active = [a for a in active if a[1] > cur]
        # add started
        for (s, e, p, d) in events:
            if s == cur:
                active.append((p, e, d))
        top = max(active, key=lambda a: a[0]) if active else None
        nxt = boundary[bi + 1] if bi + 1 < len(boundary) else cur
        if top and nxt > cur:
            segs.append((cur, nxt, top[0]))
        bi += 1
    # merge adjacent same-pitch segments
    merged = []
    for s, e, p in segs:
        if merged and merged[-1][2] == p:
            merged[-1] = (merged[-1][0], e, p)
        else:
            merged.append((s, e, p))
    beats = []
    for s, e, p in merged:
        sb = s / ppq
        db = (e - s) / ppq
        # round to grid
        sb = round(sb / grid) * grid
        db = max(grid, round(db / grid) * grid)
        beats.append((sb, db, p))
    return beats


def main():
    path = sys.argv[1]
    lo = float(sys.argv[2]) if len(sys.argv) > 2 else 40
    hi = float(sys.argv[3]) if len(sys.argv) > 3 else 100
    grid = float(sys.argv[4]) if len(sys.argv) > 4 else 0.25
    beats = extract(path, min_pitch=lo, max_pitch=hi, grid=grid)
    print(f'{len(beats)} melody segments (pitch {lo}-{hi}, grid {grid}):')
    for sb, db, p in beats:
        print(f'  {name(p)} x{db:5.2f}  (midi {p}, beat {sb:6.2f})')


if __name__ == '__main__':
    main()
