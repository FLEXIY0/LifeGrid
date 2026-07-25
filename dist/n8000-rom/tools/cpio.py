#!/usr/bin/env python3
"""Extract / build a newc ("070701") cpio archive, gzip-wrapped, for Android
ramdisks. Written because busybox cpio isn't present in every environment.

    ./cpio.py extract ramdisk.gz outdir/
    ./cpio.py build   outdir/    ramdisk.gz
    ./cpio.py list    ramdisk.gz

Preserves mode, uid/gid and symlink targets, and rebuilds entries in the same
order they were read, so a round trip with no edits is byte-stable in practice.
Metadata that newc carries but Android's init never looks at (inode numbers,
timestamps, device numbers) is normalised on build.
"""

import gzip
import io
import json
import os
import stat
import sys

MAGIC = b"070701"
TRAILER = "TRAILER!!!"
S_IFMT = 0o170000


def _h(data, off):
    return int(data[off:off + 8], 16)


def _read(path):
    raw = open(path, "rb").read()
    if raw[:2] == b"\x1f\x8b":
        return gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
    return raw


def parse(path):
    """Yield (name, mode, uid, gid, data) in archive order."""
    d = _read(path)
    i = 0
    while i < len(d):
        if d[i:i + 6] != MAGIC:
            break
        mode, uid, gid, fsz, nsz = (_h(d, i + 14), _h(d, i + 22),
                                    _h(d, i + 30), _h(d, i + 54),
                                    _h(d, i + 94))
        name = d[i + 110:i + 110 + nsz - 1].decode("utf-8", "replace")
        hdr = 110 + nsz
        hdr += (-hdr) % 4
        data = d[i + hdr:i + hdr + fsz]
        nxt = hdr + fsz
        nxt += (-nxt) % 4
        if name == TRAILER:
            break
        yield name, mode, uid, gid, data
        i += nxt


def extract(archive, outdir):
    os.makedirs(outdir, exist_ok=True)
    manifest = []
    count = 0
    for name, mode, uid, gid, data in parse(archive):
        target = os.path.join(outdir, name)
        kind = mode & S_IFMT
        manifest.append(dict(name=name, mode=mode, uid=uid, gid=gid))
        if kind == stat.S_IFDIR:
            os.makedirs(target, exist_ok=True)
        elif kind == stat.S_IFLNK:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if os.path.lexists(target):
                os.remove(target)
            os.symlink(data.decode("utf-8", "replace"), target)
        else:
            os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
            open(target, "wb").write(data)
            count += 1
    with open(os.path.join(outdir, ".cpio-manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    print("extracted %d entries (%d regular files) to %s/"
          % (len(manifest), count, outdir))


def build(indir, out_archive):
    """Rebuild using .cpio-manifest.json for order and permissions."""
    mpath = os.path.join(indir, ".cpio-manifest.json")
    if not os.path.exists(mpath):
        raise SystemExit("missing %s - extract with this tool first" % mpath)
    manifest = json.load(open(mpath))

    out = bytearray()
    ino = 300000
    for ent in manifest:
        name, mode, uid, gid = ent["name"], ent["mode"], ent["uid"], ent["gid"]
        path = os.path.join(indir, name)
        kind = mode & S_IFMT
        if kind == stat.S_IFDIR:
            data = b""
        elif kind == stat.S_IFLNK:
            data = os.readlink(path).encode()
        else:
            data = open(path, "rb").read()

        ino += 1
        namebytes = name.encode() + b"\x00"
        hdr = (MAGIC
               + b"%08X" % ino + b"%08X" % mode + b"%08X" % uid + b"%08X" % gid
               + b"%08X" % 1          # nlink
               + b"%08X" % 0          # mtime - normalised
               + b"%08X" % len(data)
               + b"%08X" % 0 + b"%08X" % 0      # devmajor/minor
               + b"%08X" % 0 + b"%08X" % 0      # rdevmajor/minor
               + b"%08X" % len(namebytes)
               + b"%08X" % 0)                   # check
        out += hdr + namebytes
        out += b"\x00" * ((-len(out)) % 4)
        out += data
        out += b"\x00" * ((-len(out)) % 4)

    trailer = TRAILER.encode() + b"\x00"
    out += (MAGIC + b"%08X" % 0 + b"%08X" % 0 + b"%08X" % 0 + b"%08X" % 0
            + b"%08X" % 1 + b"%08X" % 0 + b"%08X" % 0
            + b"%08X" % 0 + b"%08X" % 0 + b"%08X" % 0 + b"%08X" % 0
            + b"%08X" % len(trailer) + b"%08X" % 0)
    out += trailer
    out += b"\x00" * ((-len(out)) % 512)

    buf = io.BytesIO()
    # mtime=0 so the output is reproducible
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=9, mtime=0) as gz:
        gz.write(bytes(out))
    open(out_archive, "wb").write(buf.getvalue())
    print("wrote %s (%d entries, %d bytes cpio, %d gzipped)"
          % (out_archive, len(manifest), len(out), os.path.getsize(out_archive)))


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    cmd = sys.argv[1]
    if cmd == "extract" and len(sys.argv) == 4:
        extract(sys.argv[2], sys.argv[3])
    elif cmd == "build" and len(sys.argv) == 4:
        build(sys.argv[2], sys.argv[3])
    elif cmd == "list":
        for name, mode, _, _, data in parse(sys.argv[2]):
            print("%06o %8d %s" % (mode, len(data), name))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
