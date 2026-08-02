"""Transcribe doom_theme.mid Lead Guitar track to song JSON, truncated to ~128 beats."""
import json, sys
sys.path.insert(0, ".")
from midi_parse import note_events, NOTE_NAMES

fmt, tracks = note_events("tools/midis/doom_theme.mid")

# Find Lead Guitar track
lead_notes = []
for t in tracks:
    if t['name'] and 'lead guitar' in t['name'].lower():
        ppq = t['ppq']
        for start, dur, pitch, ch in t['notes']:
            if 40 <= pitch <= 55:
                lead_notes.append((start / ppq, dur / ppq, pitch))
        break

lead_notes.sort(key=lambda n: n[0])
print(f"Raw: {len(lead_notes)} notes, {sum(d for _,d,_ in lead_notes):.1f} beats", file=sys.stderr)

# Truncate to exactly 128 beats (32 bars)
MAX_BEATS = 128
truncated = []
for sb, db, pitch in lead_notes:
    if sb >= MAX_BEATS:
        break
    if db < 0.1:
        continue
    # Clamp note to not exceed MAX_BEATS
    if sb + db > MAX_BEATS:
        db = MAX_BEATS - sb
    if db < 0.1:
        continue
    truncated.append((sb, db, pitch))

# Remove overlapping notes (when two notes start within 0.1 beat, keep highest pitch)
deduped = []
i = 0
while i < len(truncated):
    sb, db, pitch = truncated[i]
    # Group notes that start at nearly the same time
    group = [(sb, db, pitch)]
    j = i + 1
    while j < len(truncated) and abs(truncated[j][0] - sb) < 0.15:
        group.append(truncated[j])
        j += 1
    # Keep only the highest pitch
    best = max(group, key=lambda x: x[2])
    deduped.append(best)
    i = j

lead_notes = deduped
print(f"Deduped: {len(lead_notes)} notes", file=sys.stderr)

def guitar_pos(pitch):
    strings = [(5, 40, "E", 2), (4, 45, "A", 2), (3, 50, "D", 3), (2, 55, "G", 3)]
    best, best_fret = None, 99
    for s, base, name, octv in strings:
        fret = pitch - base
        if 0 <= fret <= 6 and fret < best_fret:
            best_fret, best = fret, (s, fret)
    if best is None:
        for s, base, name, octv in strings:
            fret = pitch - base
            if 0 <= fret <= 12 and fret < best_fret:
                best_fret, best = fret, (s, fret)
    return best

steps = []
for start, dur, pitch in lead_notes:
    dur = max(0.25, round(dur * 4) / 4)
    pos = guitar_pos(pitch)
    if not pos:
        continue
    string, fret = pos
    note_name = NOTE_NAMES[pitch % 12]
    note_oct = (pitch // 12) - 1
    finger = {1:"1",2:"2",3:"3",4:"4"}.get(fret, "")
    
    steps.append({
        "type": "note",
        "note": note_name,
        "octave": note_oct,
        "string": string,
        "fret": fret,
        "finger": finger,
        "beats": round(dur, 2)
    })

song = {
    "id": "at-dooms-gate",
    "name": "At Doom's Gate",
    "difficulty": "rock-star",
    "category": "video-games",
    "order": 1,
    "recommendedBpm": 110,
    "beatsPerBar": 4,
    "steps": steps
}

total_beats = sum(s["beats"] for s in steps)
print(f"Steps: {len(steps)}, beats: {total_beats:.2f}, bars: {total_beats/4:.0f}", file=sys.stderr)
with open("src/songs/at-dooms-gate.json", "w") as f:
    json.dump(song, f, indent=2)
    f.write("\n")
print("Written to src/songs/at-dooms-gate.json", file=sys.stderr)
