# Tuned LineageOS 16 for the Samsung GT-N8000

Builds a flashable ROM zip: stock `lineage-16.0-20201207-HTML6405-n8000` plus the
fixes that Magisk modules cannot reach, because they live in the `fstab` inside
`boot.img` and in `build.prop`, which is read before Magisk starts.

**Requires Python 3 and nothing else.** No debugfs, no brotli, no WSL — works on
Windows, macOS and Linux.

## Build it

```bat
python build_rom.py
```

That downloads the stock ROM (~399 MiB) into the current directory, checks its
md5, and writes `lineage-16.0-20201207-n8000-tuned.zip`.

Already have the stock zip? Point at it and skip the download:

```bat
python build_rom.py --base C:\path\to\lineage-16.0-20201207-HTML6405-n8000.zip
```

## What it changes

**In `boot.img`** — the ramdisk only; the kernel is copied byte for byte:

| File | Change | Why |
|------|--------|-----|
| `fstab.smdk4x12` | `zramsize` 400 MB → **768 MB** | 400 MB is conservative for 2 GB. Sizing it in the fstab is cleaner than the Magisk module's swapoff/reset/swapon on a live system. |
| `fstab.smdk4x12` | `/data`, `/cache`: `discard` → **`nodiscard`** | Continuous TRIM stutters on aged eMMC. Pairs with the boot-time `fstrim` the Magisk module already runs. |
| `init.smdk4x12.rc` | remove `read_ahead_kb 512` | It was written twice with different values (512 here, 256 in `init.target.rc`), so the winner depended on script order. |
| `init.target.rc` | `read_ahead_kb` 256 → **128** | Large read-ahead evicts useful page cache on a 2 GB device. |

**In `/system/build.prop`** — four values changed, the rest additive:
`ro.lmk.upgrade_pressure` 40 → 60, `ro.lmk.kill_heaviest_task` → true,
`wifi.supplicant_scan_interval` → 300,
`ro.vendor.qti.sys.fw.trim_cache_percent` 100 → 50 (the value the maintainer
appears to have intended — only the `qti`-prefixed copy is live).
Added: `persist.sys.io.scheduler=row`, `ro.config.max_starting_bg=1`,
`dalvik.vm.dex2oat-threads=2`, `dex2oat-swap`, `pm.dexopt.*=speed-profile`.

**In `/system/etc/gps.conf`** — global `pool.ntp.org` instead of the
maintainer's Austrian NTP servers, which slow time-to-first-fix elsewhere.

Nothing is **removed** from `build.prop`. The audit found 36 properties no
binary in `/system` reads, but that scan cannot see apps in `/data`, and
properties like `ro.build.characteristics` are read by third-party apps —
deleting them would risk app-visible behaviour for no measurable gain.

Reasoning and evidence for every line: [`../n8000-tweaks/FINDINGS.md`](../n8000-tweaks/FINDINGS.md)
and [`../n8000-tweaks/AUDIT-EXHAUSTIVE.md`](../n8000-tweaks/AUDIT-EXHAUSTIVE.md).

## Why this is a low-risk way to do it

`system.new.dat.br` — the 410 MiB system image — is copied through **byte for
byte** and never unpacked, edited or recompressed. The flash still runs the
stock `block_image_update`. Our `/system` edits are applied afterwards by the
updater-script, on the device, inserted *after* `backuptool.sh restore` so
nothing clobbers them.

## What was verified when building this

Checked mechanically, not by eye:

- unpack → repack of the stock `boot.img` with no edits is **byte-identical**
- the rebuilt `boot.img` keeps the stock kernel bytes exactly, and
  `kernel_addr`, `ramdisk_addr`, `tags_addr`, `page_size` and `cmdline` unchanged
- the rebuilt ramdisk has the **same 66 entries with the same modes**, and
  exactly three files differ — the three intended
- every other zip entry is byte-identical to the stock package, including
  `system.new.dat.br` (sha256 compared), and each entry keeps its original
  compression method
- the only updater-script change is the seven inserted lines

The build aborts rather than producing a silently-wrong ROM if any patch target
is missing, if the kernel bytes change, or if a header field moves.

## What was NOT verified — read this

**Nobody has booted this.** There is no hardware in the build environment. Every
check above is static. Treat the first boot as the real test.

Before flashing:

1. **TWRP → Backup → boot + system + data.** Not optional.
2. Flash the zip in TWRP. Signature verification must be off (TWRP's default) —
   rebuilding the zip invalidates the original signature.
3. If it does not boot: TWRP → Restore. Failing that, Odin with a stock boot
   image. `/system` is written by the stock mechanism, so it is the recoverable
   part.

After it boots, confirm the changes landed:

```bash
adb shell cat /sys/block/mmcblk0/queue/scheduler      # want [row]
adb shell cat /sys/block/mmcblk0/queue/read_ahead_kb  # want 128
adb shell "cat /proc/swaps"                           # zram ~768 MB
adb shell mount | grep f2fs                           # want nodiscard
adb shell getprop ro.lmk.upgrade_pressure             # want 60
```

`../n8000-tweaks/uv-check.sh` covers these plus AFTR, Mali DVFS and thermals.

## Relationship to the Magisk modules

The two layers are complementary, not alternatives:

| Layer | Handles |
|-------|---------|
| **This ROM** | `fstab`, and properties read before Magisk exists |
| **`../n8000-tweaks`** | runtime sysfs tuning (AFTR, Mali DVFS, f2fs, busfreq) and `settings` values, which need root on a live system |

Flash the ROM, then install the modules.

## Tools

`tools/bootimg.py` and `tools/cpio.py` are standalone and usable on their own:

```bat
python tools\bootimg.py unpack boot.img out\
python tools\cpio.py    list   out\ramdisk.gz
```
