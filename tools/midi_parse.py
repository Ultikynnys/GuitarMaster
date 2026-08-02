#!/usr/bin/env python3
"""Minimal SMF (Standard MIDI File) parser — stdlib only.

Usage:
  python3 tools/midi_parse.py <file.mid> [--notes] [--melody] [--summary]

--notes   dump every note event as: start_beat, dur_beats, midi_pitch, ch, track
--melody  collapse to a single monophonic-ish list per track (lowest note when
          overlapping), rounded to 1/8th of a beat, printed as pitch + beats
--summary one line per track: name, channel, note count, pitch range
"""
import sys, struct
from collections import defaultdict

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def read_varlen(data, off):
    value = 0
    while True:
        b = data[off]
        off += 1
        value = (value << 7) | (b & 0x7F)
        if not (b & 0x80):
            return value, off


def parse(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:4] == b'MThd', 'not a MIDI file'
    fmt, ntrks, div = struct.unpack('>HHH', data[8:14])
    ppq = div & 0x7FFF
    assert not (div & 0x8000), 'SMPTE timing not supported'
    off = 14
    tracks = []
    for _ in range(ntrks):
        assert data[off:off + 4] == b'MTrk', 'bad track header'
        (tlen,) = struct.unpack('>I', data[off + 4:off + 8])
        tracks.append(data[off + 8:off + 8 + tlen])
        off += 8 + tlen
    return fmt, ppq, tracks


def decode_track(raw):
    """Return (events, track_name, tempo_map, timesig_map)."""
    events = []          # (tick, kind, ...)
    track_name = None
    tempo = 500000       # default 120 BPM
    tempos = []          # (tick, microseconds_per_quarter)
    timesigs = []        # (tick, numerator, denominator)
    tick = 0
    off = 0
    running_status = None
    while off < len(raw):
        delta, off = read_varlen(raw, off)
        tick += delta
        b = raw[off]
        if b == 0xFF:  # meta
            off += 1
            (mtype,) = struct.unpack('>B', raw[off:off + 1])
            off += 1
            mlen, off = read_varlen(raw, off)
            payload = raw[off:off + mlen]
            off += mlen
            if mtype == 0x03:
                track_name = payload.decode('latin-1', errors='replace')
            elif mtype == 0x51:
                (tempo,) = struct.unpack('>I', b'\x00' + payload[:3])
                tempos.append((tick, tempo))
            elif mtype == 0x58:
                timesigs.append((tick, payload[0], 1 << payload[1]))
        elif b == 0xF0 or b == 0xF7:  # sysex
            _, off = read_varlen(raw, off + 1)
            off += _
        else:
            status = b if b & 0x80 else running_status
            if status is None:
                raise ValueError('running status with no prior status')
            if status < 0x80:
                raise ValueError(f'bad status byte {b:#x}')
            running_status = status
            if b & 0x80:
                off += 1
            kind = status & 0xF0
            chan = status & 0x0F
            if kind == 0x90:
                note, vel = raw[off], raw[off + 1]
                off += 2
                events.append((tick, 'on', chan, note, vel))
            elif kind == 0x80:
                note, vel = raw[off], raw[off + 1]
                off += 2
                events.append((tick, 'off', chan, note, vel))
            elif kind == 0xA0 or kind == 0xB0 or kind == 0xE0:
                off += 2
            elif kind == 0xC0 or kind == 0xD0:
                off += 1
            else:
                raise ValueError(f'unsupported event {status:#x}')
    return events, track_name, tempos, timesigs


def note_events(path):
    fmt, ppq, tracks = parse(path)
    per_track = []
    for idx, raw in enumerate(tracks):
        events, name, tempos, timesigs = decode_track(raw)
        # note-on velocity 0 == note-off
        offs = defaultdict(list)
        notes = []
        for ev in events:
            if ev[1] == 'on':
                _, _, ch, note, vel = ev
                if vel == 0:
                    offs[(ch, note)].append(ev[0])
                else:
                    offs[(ch, note)].append(None)  # placeholder
            elif ev[1] == 'off':
                _, _, ch, note, vel = ev
                offs[(ch, note)].append(ev[0])
        # pair ons/offs
        stack = {}
        for ev in events:
            if ev[1] == 'on':
                _, _, ch, note, vel = ev
                if vel == 0:
                    start = stack.pop((ch, note), None)
                    if start is not None:
                        notes.append((start, ev[0] - start, note, ch))
                else:
                    stack[(ch, note)] = ev[0]
            elif ev[1] == 'off':
                _, _, ch, note, _ = ev
                start = stack.pop((ch, note), None)
                if start is not None:
                    notes.append((start, ev[0] - start, note, ch))
        # close any dangling
        for (ch, note), start in stack.items():
            notes.append((start, 0, note, ch))
        per_track.append({'index': idx, 'name': name, 'ppq': ppq, 'tempos': tempos, 'timesigs': timesigs, 'notes': notes})
    return fmt, per_track


def tick_to_beat(tick, ppq, tempos):
    # assume constant tempo unless noted; return in quarter-note beats
    return tick / ppq


def main():
    args = sys.argv[1:]
    path = args[0]
    mode = 'summary'
    if '--notes' in args:
        mode = 'notes'
    if '--melody' in args:
        mode = 'melody'
    fmt, tracks = note_events(path)
    print(f'format {fmt}, {len(tracks)} tracks')
    for t in tracks:
        notes = t['notes']
        if not notes:
            continue
        notes = sorted(notes)
        pitches = [n[2] for n in notes]
        if mode == 'summary':
            print(f"track {t['index']} '{t['name']}': {len(notes)} notes, pitch {min(pitches)}-{max(pitches)}, "
                  f"tempos={[(tk, round(60000000/uspb)) for tk, uspb in t['tempos']][:4]} timesigs={t['timesigs'][:4]}")
        elif mode == 'notes':
            print(f"--- track {t['index']} '{t['name']}' ---")
            for start, dur, pitch, ch in notes:
                print(f"  b={start / t['ppq']:7.3f} dur={dur / t['ppq']:6.3f} p={pitch:3d} {NOTE_NAMES[pitch % 12]}{(pitch // 12) - 1:2d} ch={ch}")
        else:
            print(f"--- track {t['index']} '{t['name']}' melody ---")
            # monophonic-ish: at any tick, only the first-started (lowest) sounding note
            ons = defaultdict(list)
            for start, dur, pitch, ch in notes:
                ons[start].append((pitch, dur))
            order = sorted(ons)
            last = None
            out = []
            for tick in order:
                pitch, dur = min(ons[tick])  # lowest
                beats = dur / t['ppq']
                if last is not None and last[0] == pitch and last[2] == 0:
                    last = (pitch, last[1] + beats, 0)
                    continue
                if last is not None:
                    out.append(last)
                last = (pitch, beats, 0)
            if last:
                out.append(last)
            for pitch, beats, _ in out:
                print(f"  {NOTE_NAMES[pitch % 12]}{(pitch // 12) - 1} x{beats:5.3f}  (midi {pitch})")


if __name__ == '__main__':
    main()
