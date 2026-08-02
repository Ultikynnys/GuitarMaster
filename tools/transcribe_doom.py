"""Transcribe doom_e1m1.mid to at-hells-gate.json — no dedup, wide range."""
import json, sys
sys.path.insert(0, ".")
from midi_parse import note_events, NOTE_NAMES

fmt, tracks = note_events("tools/midis/doom_e1m1.mid")

# Collect all notes in guitar range from all tracks
all_notes = []
for t in tracks:
    ppq = t['ppq']
    for start, dur, pitch, ch in t['notes']:
        if 40 <= pitch <= 65:
            all_notes.append((start / ppq, dur / ppq, pitch, ch))

# Group by channel, pick channel with most notes
from collections import Counter
ch_counts = Counter(ch for _,_,_,ch in all_notes)
best_ch = ch_counts.most_common(1)[0][0]
notes = [(sb, db, p) for sb, db, p, ch in all_notes if ch == best_ch]
notes.sort(key=lambda n: n[0])

print(f"Channel {best_ch}: {len(notes)} notes, {sum(d for _,d,_ in notes):.1f} beats", file=sys.stderr)

# Truncate to ~128 beats  
MAX_BEATS = 132
truncated = []
for sb, db, pitch in notes:
    if sb >= MAX_BEATS:
        break
    if db < 0.08:
        continue
    if sb + db > MAX_BEATS:
        db = MAX_BEATS - sb
    if db < 0.08:
        continue
    db = max(0.125, round(db * 8) / 8)  # quantize to 8th notes
    truncated.append((sb, db, pitch))

# Merge adjacent same-pitch
merged = []
for sb, db, pitch in truncated:
    if merged and merged[-1][2] == pitch and abs(merged[-1][0] + merged[-1][1] - sb) < 0.02:
        merged[-1] = (merged[-1][0], sb + db - merged[-1][0], pitch)
    else:
        merged.append((sb, db, pitch))

print(f"Merged: {len(merged)} notes, {sum(d for _,d,_ in merged):.1f} beats", file=sys.stderr)

# Re-truncate after merge
merged2 = []
for sb, db, pitch in merged:
    if sb >= MAX_BEATS:
        break
    if sb + db > MAX_BEATS:
        db = MAX_BEATS - sb
    if db < 0.08:
        continue
    merged2.append((sb, db, pitch))
merged = merged2

def guitar_pos(pitch):
    strings = [(5, 40, "E", 2), (4, 45, "A", 2), (3, 50, "D", 3), (2, 55, "G", 3), (1, 59, "B", 3)]
    best_pos, best_fret = None, 99
    for s, base, name, octv in strings:
        fret = pitch - base
        if 0 <= fret <= 5 and fret < best_fret:
            best_fret, best_pos = fret, (s, fret)
    if best_pos is None:
        for s, base, name, octv in strings:
            fret = pitch - base
            if 0 <= fret <= 9 and fret < best_fret:
                best_fret, best_pos = fret, (s, fret)
    return best_pos

steps = []
for start, dur, pitch in merged:
    dur = round(dur * 8) / 8  # quantize to 8th note, allow 0.125
    pos = guitar_pos(pitch)
    if not pos:
        continue
    string, fret = pos
    note_name = NOTE_NAMES[pitch % 12]
    note_oct = (pitch // 12) - 1
    finger = {0:"", 1:"1",2:"2",3:"3",4:"4"}.get(fret, "4")
    steps.append({
        "type": "note", "note": note_name, "octave": note_oct,
        "string": string, "fret": fret, "finger": finger,
        "beats": round(dur, 2)
    })

total_beats = sum(s["beats"] for s in steps)
bars_needed = int(total_beats / 4) + (1 if total_beats % 4 > 0.01 else 0)
target = bars_needed * 4
pad = round(target - total_beats, 2)
if pad > 0:
    steps.append({"type": "note", "note": "E", "octave": 2, "string": 5, "fret": 0, "finger": "", "beats": pad})

song = {
    "id": "at-hells-gate",
    "name": "At Hell's Gate (E1M1)",
    "difficulty": "rock-star",
    "category": "video-games",
    "order": 4,
    "recommendedBpm": 110,
    "beatsPerBar": 4,
    "steps": steps
}

total_beats = sum(s["beats"] for s in steps)
print(f"Steps: {len(steps)}, beats: {total_beats:.2f}, bars: {total_beats/4:.0f}", file=sys.stderr)

with open("src/songs/at-hells-gate.json", "w") as f:
    json.dump(song, f, indent=2)
    f.write("\n")
print("Written", file=sys.stderr)
