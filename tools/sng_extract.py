#!/usr/bin/env python3
"""Extract files from a Clone Hero .sng container (zlib-compressed zip)."""
import sys, struct, zlib, os

def extract_sng(path, outdir):
    raw = open(path, 'rb').read()
    # SNGPKG magic + 2-byte version, then the zip payload
    assert raw[:6] == b'SNGPKG', 'not an SNG file'
    payload = raw[8:]
    # find End Of Central Directory
    eocd = payload.rfind(b'PK\x05\x06')
    if eocd == -1:
        # maybe plain zip? try zlib on whole payload
        raise SystemExit('no EOCD found')
    (disc, cd_start_disc, cd_disc_entries, cd_entries, cd_size, cd_offset, comment_len) = struct.unpack('<HHHHIIH', payload[eocd + 4:eocd + 22])
    os.makedirs(outdir, exist_ok=True)
    for i in range(cd_entries):
        off = cd_offset + i * 46
        sig, ver, flags, method, mtime, mdate, crc, csize, usize, nl, el, cl, loff = struct.unpack('<IHHHHHIIIHHHH', payload[off:off + 46])
        assert sig == 0x02014B50
        name = payload[off + 46:off + 46 + nl].decode('utf-8', errors='replace')
        # local header
        lsig, lver, lflags, lmethod, lmtime, lmdate, lcrc, lcsize, lusize, lnl, lel = struct.unpack('<IHHHHHIIIHH', payload[loff:loff + 30])
        data = payload[loff + 30 + lnl + lel: loff + 30 + lnl + lel + lcsize]
        try:
            content = zlib.decompress(data)
        except Exception:
            content = data  # possibly stored raw
        dest = os.path.join(outdir, name.replace('/', os.sep))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'wb') as f:
            f.write(content)
        print(f'{name} ({len(content)} bytes)')

if __name__ == '__main__':
    extract_sng(sys.argv[1], sys.argv[2])
