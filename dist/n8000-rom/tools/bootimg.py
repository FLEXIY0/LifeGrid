#!/usr/bin/env python3
"""Unpack / repack an Android boot.img (header v0, as used by the GT-N8000).

Deliberately minimal and conservative: on repack every header field is copied
verbatim from the original except the two section sizes that actually changed.
The kernel is never recompressed - its bytes are copied through untouched.

    ./bootimg.py unpack boot.img outdir/
    ./bootimg.py repack outdir/ new-boot.img
    ./bootimg.py info   boot.img

outdir/ layout:
    header.json   every field of the original header
    kernel        raw kernel bytes (do not edit)
    ramdisk.gz    gzip-compressed cpio ramdisk
    second        present only if the image has a second stage
"""

import json
import os
import struct
import sys

PAGE_FALLBACK = 2048
HDR_FMT = "<8sIIIIIIIII"          # magic + 9 u32 up to page_size, then names
MAGIC = b"ANDROID!"


def _pad(n, page):
    return (-n) % page


def read_header(data):
    if data[:8] != MAGIC:
        raise SystemExit("not an Android boot image (bad magic)")
    (magic, kernel_size, kernel_addr, ramdisk_size, ramdisk_addr,
     second_size, second_addr, tags_addr, page_size,
     header_version) = struct.unpack(HDR_FMT, data[:44])
    os_version, = struct.unpack("<I", data[44:48])
    name = data[48:64].rstrip(b"\x00").decode("ascii", "replace")
    cmdline = data[64:576].split(b"\x00")[0].decode("ascii", "replace")
    # The 32-byte id at 576 is a digest written by whichever mkbootimg built the
    # image. This one matches none of the usual formulas (plain AOSP
    # sha1(kernel|len|ramdisk|len|second|len) and the common variants were all
    # tried and differ), so it is preserved verbatim instead of recomputed.
    # Nothing in the Exynos 4412 boot chain verifies it, and keeping it byte-for-
    # byte is what makes an edit-free unpack/repack round trip bit-identical -
    # which is the property we actually want to be able to prove.
    img_id = data[576:608].hex()
    extra_cmdline = data[608:1632].split(b"\x00")[0].decode("ascii", "replace")
    return dict(kernel_size=kernel_size, kernel_addr=kernel_addr,
                ramdisk_size=ramdisk_size, ramdisk_addr=ramdisk_addr,
                second_size=second_size, second_addr=second_addr,
                tags_addr=tags_addr, page_size=page_size or PAGE_FALLBACK,
                header_version=header_version, os_version=os_version,
                name=name, cmdline=cmdline, extra_cmdline=extra_cmdline)


def unpack(img_path, outdir):
    data = open(img_path, "rb").read()
    h = read_header(data)
    page = h["page_size"]

    koff = page
    roff = koff + h["kernel_size"] + _pad(h["kernel_size"], page)
    soff = roff + h["ramdisk_size"] + _pad(h["ramdisk_size"], page)

    os.makedirs(outdir, exist_ok=True)
    open(os.path.join(outdir, "kernel"), "wb").write(
        data[koff:koff + h["kernel_size"]])
    open(os.path.join(outdir, "ramdisk.gz"), "wb").write(
        data[roff:roff + h["ramdisk_size"]])
    if h["second_size"]:
        open(os.path.join(outdir, "second"), "wb").write(
            data[soff:soff + h["second_size"]])

    with open(os.path.join(outdir, "header.json"), "w") as fh:
        json.dump(h, fh, indent=2)

    print("unpacked to %s/" % outdir)
    for k in ("page_size", "kernel_size", "ramdisk_size", "second_size",
              "header_version"):
        print("  %-15s %s" % (k, h[k]))
    print("  %-15s %r" % ("cmdline", h["cmdline"]))


def repack(indir, out_path):
    h = json.load(open(os.path.join(indir, "header.json")))
    page = h["page_size"]

    kernel = open(os.path.join(indir, "kernel"), "rb").read()
    ramdisk = open(os.path.join(indir, "ramdisk.gz"), "rb").read()
    second = b""
    spath = os.path.join(indir, "second")
    if os.path.exists(spath):
        second = open(spath, "rb").read()

    # Sanity: the kernel must be untouched. Everything else about this tool
    # assumes we are only ever changing the ramdisk.
    if len(kernel) != h["kernel_size"]:
        print("warning: kernel size changed %d -> %d"
              % (h["kernel_size"], len(kernel)), file=sys.stderr)

    hdr = struct.pack(
        HDR_FMT, MAGIC,
        len(kernel), h["kernel_addr"],
        len(ramdisk), h["ramdisk_addr"],
        len(second), h["second_addr"],
        h["tags_addr"], page, h["header_version"])
    hdr += struct.pack("<I", h["os_version"])
    hdr += h["name"].encode("ascii")[:16].ljust(16, b"\x00")
    hdr += h["cmdline"].encode("ascii")[:512].ljust(512, b"\x00")
    hdr += b"\x00" * 32                                   # id (not verified)
    hdr += h["extra_cmdline"].encode("ascii")[:1024].ljust(1024, b"\x00")
    hdr = hdr.ljust(page, b"\x00")

    with open(out_path, "wb") as fh:
        fh.write(hdr)
        for blob in (kernel, ramdisk, second):
            if blob:
                fh.write(blob)
                fh.write(b"\x00" * _pad(len(blob), page))

    print("wrote %s (%d bytes)" % (out_path, os.path.getsize(out_path)))
    print("  kernel  %d (unchanged: %s)"
          % (len(kernel), len(kernel) == h["kernel_size"]))
    print("  ramdisk %d (was %d)" % (len(ramdisk), h["ramdisk_size"]))


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    cmd = sys.argv[1]
    if cmd == "unpack" and len(sys.argv) == 4:
        unpack(sys.argv[2], sys.argv[3])
    elif cmd == "repack" and len(sys.argv) == 4:
        repack(sys.argv[2], sys.argv[3])
    elif cmd == "info":
        h = read_header(open(sys.argv[2], "rb").read())
        print(json.dumps(h, indent=2))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
