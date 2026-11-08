#!/usr/bin/env python3
"""Write the invisible characters that tools/check-control-chars.py refuses back as escapes.

A tool that writes a text can turn an escape in it (a backslash, u, 200B) into the character itself. This turns
every such character into the escape again, in place:

    python tools/escape-hidden.py FILE ...

Fit for source files (TypeScript, JavaScript, Markdown with code), where the escape means the character.
"""

import sys, re
BS = chr(92)
CODES = [0xAD] + list(range(0x200B, 0x2010)) + [0x2028, 0x2029] + list(range(0x202A, 0x202F)) + list(range(0x2060, 0x2065)) + list(range(0x2066, 0x206A)) + [0xFEFF]
BAD = set(chr(c) for c in CODES)
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read()
    t = ''.join(BS + 'u%04X' % ord(c) if c in BAD else c for c in s)
    if t != s:
        open(path, 'w', encoding='utf-8', newline='\n').write(t)
        print('fixed', path)
