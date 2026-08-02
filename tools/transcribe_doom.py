"""Regenerate at-hells-gate.json — no same-pitch merging, clean 8th-note quantize."""
import json, sys
sys.path.insert(0, ".")
from midi_parse import note_events, NOTE_NAMES

fmt, tracks = note_events("tools/midis/doom_e1m1.mid")

# Pick channel with most notes in 40-65 range
from collections import Counter
all_notes = []
for t in tracks:
    ppq = t['ppq']
    for start, dur, pitch, ch in t['notes']:
        if 40 <= pitch <= 65:
            all_notes.append((start / ppq, dur / ppq, pitch, ch))
ch_counts = Counter(ch for _,_,_,ch in all_notes)
best_ch = ch_counts.most_common(1)[0][0]
notes = [(sb, db, p) for sb, db, p, ch in all_notes if ch == best_ch]
notes.sort(key=lambda n: n[0])

print(f"Channel {best_ch}: {len(notes)} raw notes", file=sys.stderr)

# Quantize and filter
MAX_BEATS = 136
quantized = []
for sb, db, pitch in notes:
    if sb >= MAX_BEATS:
        break
    if db < 0.08:
        continue
    # Quantize start and duration to 16th notes
    sb_q = round(sb * 4) / 4
    db_q = max(0.125, round(db * 8) / 8)
    if sb_q + db_q > MAX_BEATS:
        db_q = MAX_BEATS - sb_q
    if db_q < 0.1:
        continue
    quantized.append((sb_q, db_q, pitch))

# Remove overlapping (keep highest pitch when notes start at same quantized time)
deduped = []
i = 0
while i < len(quantized):
    sb, db, pitch = quantized[i]
    # Collect all notes at this quantized start
    group = [(sb, db, pitch)]
    j = i + 1
    while j < len(quantized) and abs(quantized[j][0] - sb) < 0.01:
        group.append(quantized[j])
        j += 1
    best = max(group, key=lambda x: x[2])
    deduped.append(best)
    i = j

# NO same-pitch merging — each note stays separate

print(f"Deduped: {len(deduped)} notes, {sum(d for _,d,_ in deduped):.1f} beats", file=sys.stderr)

def guitar_pos(pitch):
    strings = [(5, 40, "E", 2), (4, 45, "A", 2), (3, 50, "D", 3), (2, 55, "G", 3)]
    best_pos, best_fret = None, 99
    for s, base, name, octv in strings:
        fret = pitch - base
        if 0 <= fret <= 6 and fret < best_fret:
            best_fret, best_pos = fret, (s, fret)
    if best_pos is None:
        for s, base, name, octv in strings:
            fret = pitch - base
            if 0 <= fret <= 9 and fret < best_fret:
                best_fret, best_pos = fret, (s, fret)
    return best_pos

steps = []
for start, dur, pitch in deduped:
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
        "beats": dur
    })

total = sum(s["beats"] for s in steps)
bars = round(total / 4)
target = bars * 4
diff = round(target - total, 3)
if diff != 0:
    steps[-1]["beats"] = round(steps[-1]["beats"] + diff, 3)
    steps[-1]["beats"] = max(0.125, round(steps[-1]["beats"] * 8) / 8)
total = sum(s["beats"] for s in steps)

print(f"Steps: {len(steps)}, beats: {total:.3f}, bars: {total/4:.0f}", file=sys.stderr)

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

with open("src/songs/at-hells-gate.json", "w") as f:
    json.dump(song, f, indent=2)
    f.write("\n")

# Verify values
beats = [s['beats'] for s in steps]
bad = [b for b in beats if round(b * 8) != b * 8]
print(f"Non-standard beats: {len(bad)}", file=sys.stderr)
if bad:
    print(f"Samples: {sorted(set(bad))[:15]}", file=sys.stderr)
