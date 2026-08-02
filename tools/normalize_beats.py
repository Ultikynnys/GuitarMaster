"""Normalize beat values in a song JSON to clean 8th-note multiples (0.125, 0.25, 0.375, ...)."""
import json, sys, os

path = sys.argv[1] if len(sys.argv) > 1 else "src/songs/at-hells-gate.json"

with open(path) as f:
    song = json.load(f)

fixed = 0
for step in song["steps"]:
    old = step["beats"]
    # Quantize to nearest 8th note, minimum 0.125
    new = round(old * 8) / 8
    if new == 0:
        new = 0.125
    if abs(new - old) > 0.001:
        fixed += 1
    step["beats"] = new

total = sum(s["beats"] for s in song["steps"])
# Adjust last note to hit bar boundary
bars = round(total / 4)
target = bars * 4
diff = round(target - total, 3)
if diff != 0:
    song["steps"][-1]["beats"] = round(song["steps"][-1]["beats"] + diff, 3)
    total = sum(s["beats"] for s in song["steps"])

# Now re-quantize only the last note
song["steps"][-1]["beats"] = round(song["steps"][-1]["beats"] * 8) / 8
if song["steps"][-1]["beats"] == 0:
    song["steps"][-1]["beats"] = 0.125
total = sum(s["beats"] for s in song["steps"])

print(f"Fixed {fixed}/{len(song['steps'])} notes, total: {total:.3f} beats, {total/4} bars")

# Remove trailing pad note if it's an identical E2 rest
if len(song["steps"]) > 1:
    last = song["steps"][-1]
    prev = song["steps"][-2]
    if last["note"] == prev["note"] and last["octave"] == prev["octave"] and last["string"] == prev["string"] and last["fret"] == prev["fret"]:
        # Merge into previous
        prev["beats"] = round(prev["beats"] + last["beats"], 3)
        prev["beats"] = round(prev["beats"] * 8) / 8
        song["steps"].pop()
        total = sum(s["beats"] for s in song["steps"])
        print(f"Merged last duplicate note, total: {total:.3f} beats")

with open(path, "w") as f:
    json.dump(song, f, indent=2)
    f.write("\n")
print("Done")
