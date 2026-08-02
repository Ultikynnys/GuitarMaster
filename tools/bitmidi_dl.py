#!/usr/bin/env python3
"""Download MIDIs from bitmidi by slug."""
import sys, re, urllib.request

sys.path.insert(0, 'tools')

def dl(slug, name):
    req = urllib.request.Request('https://bitmidi.com/' + slug, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    try:
        html = urllib.request.urlopen(req, timeout=25).read().decode('utf-8', errors='replace')
    except Exception as e:
        print(f'{name}: page ERR {e}')
        return
    m = re.search(r'href="(/uploads/[0-9]+\.mid)"', html)
    if not m:
        print(f'{name}: no download link')
        return
    req2 = urllib.request.Request('https://bitmidi.com' + m.group(1), headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://bitmidi.com/' + slug})
    data = urllib.request.urlopen(req2, timeout=60).read()
    open('tools/midis/' + name, 'wb').write(data)
    print(f'{name}: saved {len(data)}B')

if __name__ == '__main__':
    jobs = [
        ('nirvana-about-a-girl-mid', 'about_a_girl.mid'),
        ('red-hot-chili-peppers-californication-mid', 'californication.mid'),
        ('ozzy-osbourne-crazy-train-mid', 'crazy_train.mid'),
        ('the-beatles-day-tripper-k-mid', 'day_tripper.mid'),
        ('guns-n-roses-sweet-child-o-mine-mid', 'sweet_child.mid'),
        ('acdc-thunderstruck-k-mid', 'thunderstruck.mid'),
        ('cream-sunshine-of-your-love-mid', 'sunshine.mid'),
        ('deep-purple-smoke-on-the-water-mid', 'smoke_on_the_water.mid'),
        ('lynyrd-skynyrd-sweet-home-alabama-mid', 'sweet_home_alabama.mid'),
        ('bad-moon-rising-1-mid', 'bad_moon_rising.mid'),
        ('guns-n-roses-knockin-on-heavens-door-mid', 'knockin.mid'),
        ('hotel-california-mid', 'hotel_california.mid'),
        ('the-animals-the-house-of-rising-sun-mid', 'house_of_rising_sun.mid'),
        ('cranberries-zombie-mid', 'zombie.mid'),
        ('e1m1-mid', 'doom_e1m1.mid'),
        ('the-eagles-hotel-california-k-mid', 'hotel_california_k.mid'),
    ]
    for slug, name in jobs:
        dl(slug, name)
