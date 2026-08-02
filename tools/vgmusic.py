#!/usr/bin/env python3
"""Fetch + filter vgmusic directory listings; download matching .mid files."""
import re, sys, os, urllib.request

BASE = 'http://www.vgmusic.com/music/'
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GuitarMaster-tools'}


def list_dir(path):
    url = BASE + path
    req = urllib.request.Request(url, headers=UA)
    html = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', errors='replace')
    return re.findall(r'href="([^"]+\.mid)"', html, re.I)


def download(rel_url, dest):
    if not rel_url.startswith('http'):
        rel_url = BASE + rel_url
    req = urllib.request.Request(rel_url, headers=UA)
    data = urllib.request.urlopen(req, timeout=60).read()
    with open(dest, 'wb') as f:
        f.write(data)
    print(f'  saved {dest} ({len(data)} bytes)')


if __name__ == '__main__':
    folder = sys.argv[1]
    patterns = sys.argv[2:]
    print(f'listing {folder} ...')
    files = list_dir(folder)
    for p in patterns:
        hits = [f for f in files if re.search(p, f, re.I)]
        print(f'--- {p!r}: {len(hits)} hits')
        for h in hits:
            print('   ', h)
