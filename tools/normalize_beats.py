"""Cap beats >0.75 to 0.75, spread overflow across last 8 notes proportionally."""
import json, sys

path = sys.argv[1] if len(sys.argv) > 1 else "src/songs/at-hells-gate.json"
with open(path) as f:
    song = json.load(f)

steps = song["steps"]
overflow = 0
capped = 0

for s in steps[:-1]:  # all except last
    old = s["beats"]
    if old > 0.75:
        overflow += old - 0.75
        s["beats"] = 0.75
        capped += 1

# Also cap the last note but keep its overflow separate
last_old = steps[-1]["beats"]
if last_old > 0.75:
    overflow += last_old - 0.75
    steps[-1]["beats"] = 0.75
    capped += 1

total = sum(s["beats"] for s in steps)
bars = round(total / 4)
target = bars * 4
total_shortfall = round(target - total, 3)

# Spread shortfall + overflow across last 8 notes proportionally
spread_count = min(8, len(steps))
for i in range(len(steps) - spread_count, len(steps)):
    share = total_shortfall / spread_count
    steps[i]["beats"] = round(steps[i]["beats"] + share, 3)
    steps[i]["beats"] = max(0.125, round(steps[i]["beats"] * 8) / 8)

total = sum(s["beats"] for s in steps)
# Final adjustment
diff = round(target - total, 3)
if diff:
    steps[-1]["beats"] = round(steps[-1]["beats"] + diff, 3)
    steps[-1]["beats"] = max(0.125, round(steps[-1]["beats"] * 8) / 8)

total = sum(s["beats"] for s in steps)
print(f"Capped {capped} notes, total: {total:.3f} beats, {total/4:.0f} bars")

# Verify
beats = [s["beats"] for s in steps]
bad = [b for b in beats if round(b * 8) != b * 8]
longs = [b for b in beats if b > 0.75]
print(f"Non-standard: {len(bad)}, >0.75: {len(longs)}/{len(beats)}")
if longs:
    from collections import Counter
    for v, n in sorted(Counter(longs).items()):
        print(f"  {v}: {n}x")

song["steps"] = steps
with open(path, "w") as f:
    json.dump(song, f, indent=2)
    f.write("\n")
