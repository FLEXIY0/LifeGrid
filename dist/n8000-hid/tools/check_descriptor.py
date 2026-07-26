#!/usr/bin/env python3
"""Parse the HID report descriptor out of the C source and verify it.

Catches the mistakes that are invisible by eye and fatal on a host: a declared
length that doesn't match the byte count, unbalanced collections, a report size
that doesn't add up to report_length, or a truncated multi-byte item.

    python3 check_descriptor.py ../kernel-patch/f_hid_android_tablet.c
"""

import re
import sys

USAGE_PAGES = {0x01: "Generic Desktop", 0x0D: "Digitizers", 0x09: "Button"}
ITEM_KIND = {0x04: "Usage Page", 0x08: "Usage", 0x14: "Logical Min",
             0x24: "Logical Max", 0x74: "Report Size", 0x94: "Report Count",
             0x80: "Input", 0xA0: "Collection", 0xC0: "End Collection"}


def load(path):
    src = open(path).read()
    decl = {}
    for key in ("report_length", "report_desc_length", "subclass", "protocol"):
        m = re.search(r"\.%s\s*=\s*(\d+)" % key, src)
        if m:
            decl[key] = int(m.group(1))
    body = src[src.index(".report_desc"):]
    body = body[body.index("{"):body.index("}")]
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    data = [int(x, 16) for x in re.findall(r"0[xX]([0-9a-fA-F]{2})", body)]
    return decl, data


def walk(data):
    """Yield (offset, kind, value, size) and track collection depth."""
    i, depth, bits, errors = 0, 0, 0, []
    rsize = rcount = None
    while i < len(data):
        b = data[i]
        size = b & 0x03
        size = 4 if size == 3 else size
        kind = b & 0xFC
        if i + size >= len(data) + 1 and size:
            errors.append("truncated item at offset %d" % i)
            break
        val = 0
        for k in range(size):
            val |= data[i + 1 + k] << (8 * k)
        name = ITEM_KIND.get(kind, "0x%02X" % kind)
        if kind == 0xA0:
            depth += 1
        elif kind == 0xC0:
            depth -= 1
            if depth < 0:
                errors.append("End Collection without Collection at %d" % i)
        elif kind == 0x74:
            rsize = val
        elif kind == 0x94:
            rcount = val
        elif kind == 0x80:            # Input
            if rsize is None or rcount is None:
                errors.append("Input at %d before Report Size/Count" % i)
            else:
                bits += rsize * rcount
        i += 1 + size
    return bits, depth, errors


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else \
        "../kernel-patch/f_hid_android_tablet.c"
    decl, data = load(path)
    print("declared: report_length=%d report_desc_length=%d subclass=%d protocol=%d"
          % (decl.get("report_length", -1), decl.get("report_desc_length", -1),
             decl.get("subclass", -1), decl.get("protocol", -1)))
    print("actual bytes in report_desc[]: %d" % len(data))

    ok = True
    if len(data) != decl.get("report_desc_length"):
        print("FAIL: report_desc_length says %d, found %d bytes"
              % (decl.get("report_desc_length"), len(data)))
        ok = False
    else:
        print("OK  : descriptor length matches")

    bits, depth, errors = walk(data)
    for e in errors:
        print("FAIL: %s" % e)
        ok = False
    if depth != 0:
        print("FAIL: %d collection(s) left unclosed" % depth)
        ok = False
    else:
        print("OK  : collections balanced")

    if bits % 8:
        print("FAIL: input fields total %d bits, not a whole number of bytes" % bits)
        ok = False
    elif bits // 8 != decl.get("report_length"):
        print("FAIL: input fields total %d bytes, report_length says %d"
              % (bits // 8, decl.get("report_length")))
        ok = False
    else:
        print("OK  : input fields total %d bytes, matches report_length" % (bits // 8))

    print("RESULT:", "descriptor is well-formed" if ok else "PROBLEMS FOUND")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
