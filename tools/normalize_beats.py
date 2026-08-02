"""Split long notes (>0.5 beat) into repeated 0.25-0.5 beat strokes."""
import json, sys

path = sys.argv[1] if len(sys.argv) > 1 else "src/songs/at-hells-gate.json"
with open(path) as f:
    song = json.load(f)

old_steps = song["steps"]
new_steps = []
fixed = 0

for s in old_steps:
    dur = s["beats"]
    if dur <= 0.5:
        new_steps.append(s)
    else:
        # Split into 0.5-beat chunks, remainder as final chunk
        while dur > 0.6:
            chunk = min(0.5, dur)
            chunk = round(chunk * 8) / 8
            new_steps.append({**s, "beats": chunk})
            dur = round(dur - chunk, 3)
            fixed += 1
        if dur > 0:
            dur = max(0.125, round(dur * 8) / 8)
            new_steps.append({**s, "beats": dur})

total = sum(s["beats"] for s in new_steps)
bars = round(total / 4)
target = bars * 4
diff = round(target - total, 3)
if diff > 0:
    new_steps[-1]["beats"] = round(new_steps[-1]["beats"] + diff, 3)
    new_steps[-1]["beats"] = max(0.125, round(new_steps[-1]["beats"] * 8) / 8)

total = sum(s["beats"] for s in new_steps)
print(f"Split {fixed} notes, {len(old_steps)}→{len(new_steps)} steps, total: {total:.3f} beats, {total/4:.0f} bars")

# Verify
beats = [s["beats"] for s in new_steps]
bad = [b for b in beats if round(b * 8) != b * 8]
longs = [b for b in beats if b > 0.75]
print(f"Non-standard: {len(bad)}, >0.75 beat: {len(longs)}/{len(beats)}")

song["steps"] = new_steps
with open(path, "w") as f:
    json.dump(song, f, indent=2)
    f.write("\n")
