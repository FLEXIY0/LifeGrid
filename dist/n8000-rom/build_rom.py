#!/usr/bin/env python3
"""Build a tuned LineageOS 16 ROM for the Samsung GT-N8000.

Pure Python 3 - no debugfs, no brotli, no sdat2img, nothing to install. Runs on
Windows, macOS and Linux alike.

    python build_rom.py                     # downloads the base ROM, builds
    python build_rom.py --base <file.zip>   # use a base ROM you already have
    python build_rom.py --skip-verify       # not recommended

Output: lineage-16.0-20201207-n8000-tuned.zip, flashable in TWRP.

HOW IT WORKS - and why it is safe
---------------------------------
The system partition image (system.new.dat.br) is copied through **byte for
byte**. It is never unpacked, edited or recompressed, so the flash still uses
the original block_image_update path from the stock package. Our /system
changes are applied afterwards by the updater-script, on the device, where the
files are already in place - that is why no ext4 tooling is needed here.

Two things are genuinely rebuilt:
  * boot.img - the ramdisk is patched (fstab + init scripts). The kernel bytes
    are copied unchanged.
  * updater-script - our file replacements are appended to the stock script.

Everything the patch does is documented in ../n8000-tweaks/FINDINGS.md.
"""

import argparse
import hashlib
import io
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "tools"))

import bootimg                                          # noqa: E402
import cpio                                             # noqa: E402

BASE_NAME = "lineage-16.0-20201207-HTML6405-n8000.zip"
BASE_URL = ("https://archive.org/download/"
            "lineage-16.0-20201207-HTML6405-n8000/" + BASE_NAME)
BASE_MD5 = "b17df8f385612fd73142ce388ed0c770"
BASE_SIZE = 418054096
OUT_NAME = "lineage-16.0-20201207-n8000-tuned.zip"

# Inserted into the stock updater-script immediately before the boot.img flash.
# Modes and SELinux labels were read out of the stock system image, so they
# match exactly what the ROM already uses (build.prop really is 0600).
PATCH_SCRIPT = '''ui_print("Applying N8000 tuning patch...");
mount("ext4", "EMMC", "/dev/block/mmcblk0p9", "/system");
package_extract_file("patch/build.prop", "/system/build.prop");
set_metadata("/system/build.prop", "uid", 0, "gid", 0, "mode", 0600, "capabilities", 0x0, "selabel", "u:object_r:system_file:s0");
package_extract_file("patch/gps.conf", "/system/etc/gps.conf");
set_metadata("/system/etc/gps.conf", "uid", 0, "gid", 0, "mode", 0644, "capabilities", 0x0, "selabel", "u:object_r:system_file:s0");
unmount("/system");
'''

BOOT_FLASH_LINE = 'package_extract_file("boot.img", "/dev/block/mmcblk0p5");'


def md5sum(path, chunk=1 << 20):
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def fetch_base(dest):
    if os.path.exists(dest):
        print("base ROM already present: %s" % dest)
        return dest
    print("downloading base ROM (~399 MiB) ...")
    print("  %s" % BASE_URL)

    def hook(count, bs, total):
        if total > 0:
            pct = min(100, count * bs * 100 // total)
            sys.stdout.write("\r  %3d%%" % pct)
            sys.stdout.flush()

    urllib.request.urlretrieve(BASE_URL, dest, reporthook=hook)
    print()
    return dest


def verify_base(path):
    size = os.path.getsize(path)
    if size != BASE_SIZE:
        raise SystemExit("base ROM size is %d, expected %d - wrong or truncated file"
                         % (size, BASE_SIZE))
    print("verifying md5 ...")
    got = md5sum(path)
    if got != BASE_MD5:
        raise SystemExit("md5 mismatch\n  got      %s\n  expected %s" % (got, BASE_MD5))
    print("  md5 %s OK" % got)


def patch_ramdisk(workdir):
    """Apply the three fstab/init fixes. Each one asserts, so a base ROM that
    doesn't look as expected aborts instead of producing a silently wrong ROM."""
    rd = os.path.join(workdir, "ramdisk")

    def edit(relpath, replacements):
        path = os.path.join(rd, relpath)
        text = open(path, "r", newline="").read()
        for old, new, label in replacements:
            if old not in text:
                raise SystemExit("patch target not found in %s: %s" % (relpath, label))
            text = text.replace(old, new)
            print("    %s: %s" % (relpath, label))
        open(path, "w", newline="").write(text)

    print("  patching ramdisk")

    # 1) zram 400 MB -> 768 MB, sized in the fstab rather than rebuilt at runtime
    # 2) drop f2fs `discard`: continuous TRIM stutters on aged eMMC. The Magisk
    #    module runs fstrim at boot instead, which is the recommended pairing.
    edit("fstab.smdk4x12", [
        ("zramsize=419430400", "zramsize=805306368",
         "zram 400MB -> 768MB"),
        ("noatime,discard,inline_xattr,inline_data,nosuid,nodev\t\twait,check,encryptable=footer",
         "noatime,nodiscard,inline_xattr,inline_data,nosuid,nodev\t\twait,check,encryptable=footer",
         "/data: discard -> nodiscard"),
        ("noatime,discard,inline_xattr,inline_data,nosuid,nodev\t\twait",
         "noatime,nodiscard,inline_xattr,inline_data,nosuid,nodev\t\twait",
         "/cache: discard -> nodiscard"),
    ])

    # 3) read_ahead_kb is written twice with different values (512 here, 256 in
    #    init.target.rc) so the winner depended on script order. Drop the 512
    #    write and pin the remaining one to 128 - large read-ahead evicts useful
    #    page cache on a 2 GB device.
    edit("init.smdk4x12.rc", [
        ("    write /sys/block/mmcblk0/queue/read_ahead_kb 512\n", "",
         "remove duplicate read_ahead_kb 512"),
    ])
    edit("init.target.rc", [
        ("write /sys/block/mmcblk0/queue/read_ahead_kb 256",
         "write /sys/block/mmcblk0/queue/read_ahead_kb 128",
         "read_ahead_kb 256 -> 128"),
    ])


def build_boot(base_zip, workdir):
    print("  rebuilding boot.img")
    with zipfile.ZipFile(base_zip) as z:
        open(os.path.join(workdir, "boot.img"), "wb").write(z.read("boot.img"))

    bootdir = os.path.join(workdir, "boot")
    bootimg.unpack(os.path.join(workdir, "boot.img"), bootdir)
    cpio.extract(os.path.join(bootdir, "ramdisk.gz"), os.path.join(workdir, "ramdisk"))

    patch_ramdisk(workdir)

    cpio.build(os.path.join(workdir, "ramdisk"), os.path.join(bootdir, "ramdisk.gz"))
    out = os.path.join(workdir, "boot-tuned.img")
    bootimg.repack(bootdir, out)

    # The kernel must be identical to the stock one - we only touched the ramdisk.
    with zipfile.ZipFile(base_zip) as z:
        orig = z.read("boot.img")
    oh = bootimg.read_header(orig)
    nh = bootimg.read_header(open(out, "rb").read())
    ok = orig[oh["page_size"]:oh["page_size"] + oh["kernel_size"]] == \
        open(out, "rb").read()[nh["page_size"]:nh["page_size"] + nh["kernel_size"]]
    print("    kernel identical to stock: %s" % ok)
    if not ok:
        raise SystemExit("kernel bytes changed - refusing to continue")
    for field in ("kernel_addr", "ramdisk_addr", "tags_addr", "page_size", "cmdline"):
        if oh[field] != nh[field]:
            raise SystemExit("header field %s changed: %r -> %r"
                             % (field, oh[field], nh[field]))
    print("    header fields preserved")
    return out


def build_zip(base_zip, boot_path, out_path):
    print("  assembling %s" % os.path.basename(out_path))
    patch_dir = os.path.join(HERE, "patch")
    added = 0
    with zipfile.ZipFile(base_zip) as src, \
            zipfile.ZipFile(out_path, "w", allowZip64=True) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "boot.img":
                data = open(boot_path, "rb").read()
            elif info.filename.endswith("updater-script"):
                text = data.decode()
                if BOOT_FLASH_LINE not in text:
                    raise SystemExit("boot flash line not found in updater-script")
                text = text.replace(BOOT_FLASH_LINE, PATCH_SCRIPT + BOOT_FLASH_LINE)
                data = text.encode()
            # keep each entry's original storage method (system.new.dat.br is
            # stored, not deflated, so streaming installers stay happy)
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type = info.compress_type
            zi.external_attr = info.external_attr
            dst.writestr(zi, data)
            added += 1
        for name, arc in (("build.prop", "patch/build.prop"),
                          ("gps.conf", "patch/gps.conf")):
            dst.write(os.path.join(patch_dir, name), arc,
                      compress_type=zipfile.ZIP_DEFLATED)
            added += 1
    print("    %d entries written" % added)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", help="path to the stock ROM zip")
    ap.add_argument("--out", default=OUT_NAME)
    ap.add_argument("--skip-verify", action="store_true")
    ap.add_argument("--keep-work", action="store_true")
    args = ap.parse_args()

    base = args.base or os.path.join(os.getcwd(), BASE_NAME)
    if not args.base:
        fetch_base(base)
    if not os.path.exists(base):
        raise SystemExit("base ROM not found: %s" % base)
    if args.skip_verify:
        print("WARNING: skipping integrity check of the base ROM")
    else:
        verify_base(base)

    work = tempfile.mkdtemp(prefix="n8000-build-")
    try:
        boot = build_boot(base, work)
        build_zip(base, boot, args.out)
    finally:
        if args.keep_work:
            print("work dir kept: %s" % work)
        else:
            shutil.rmtree(work, ignore_errors=True)

    print("\ndone: %s (%.1f MiB)"
          % (args.out, os.path.getsize(args.out) / 1048576.0))
    print("sha256: %s" % hashlib.sha256(open(args.out, "rb").read()).hexdigest())
    print("\nFlash in TWRP. Back up boot + system + data FIRST - this has not")
    print("been boot-tested on hardware by anyone but you.")


if __name__ == "__main__":
    main()
