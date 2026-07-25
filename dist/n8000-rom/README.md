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

**In `/system/usr/idc/sec_e-pen.idc`** — the biggest single defect found in this
ROM, and it sits on the device's best hardware. The stock file was two lines:

```
touch.deviceType = pointer
touch.orientationAware = 1
```

`pointer` describes an *indirect* device — a mouse or trackpad. This is an
absolute-position **Wacom G5SP** digitizer with **1024 pressure levels**
(`WACOM_MAX_PRESSURE = 1023`), and Android has a dedicated `stylus` type for
exactly that. With `pointer`, apps checking `MotionEvent.TOOL_TYPE_STYLUS` never
see a stylus and a mouse cursor trails the pen — the complaint that recurs in
this device's Lineage threads. There was also **no pressure calibration at all**.
The patch sets `deviceType = stylus` and states the scale explicitly:
`pressure.scale = 0.000978` (1/1023).

> If you have seen the widely-copied XDA value `0.000244` — that is 1/4096, for
> digitizers with 4096 levels. On this hardware it would waste three quarters of
> the range.

**USB comes up dead on a fresh flash.** `default.prop` ships
`persist.sys.usb.config=none`, and `init.usb.rc` copies that to
`sys.usb.config` on boot, where the `none` handler calls `stop adbd`. So there
is no MTP and no ADB until the framework's `UsbDeviceManager` starts and picks a
mode. On a healthy boot that self-corrects — but if the ROM ever hangs before
the framework comes up, USB is dead exactly when you need `adb` to find out
why. The patch sets `persist.sys.usb.config=mtp,adb`, which
`init.smdk4x12.usb.rc` handles (idProduct 6860). `persist.*` values are re-read
from `/data` once it mounts, so your own USB choice in Settings still wins —
this only covers the fresh-flash window. `ro.adb.secure=1` is untouched, so a
new host still has to be authorised by RSA key.

**A browser with a real engine.** Via and Jelly are 968 KB and 1.6 MB — that
size is only possible because they are thin wrappers around Android 9's
**WebView**. That ancient engine is why they render modern sites badly; the UI
was never the problem. The build bundles **Fennec F-Droid** (armeabi-v7a) into
`/system/app` and deletes Via.

- Fennec ships its own **Gecko** engine and supports **uBlock Origin**, which on
  hardware this slow is the single largest speed-up available — most of the work
  a modern page costs this CPU is ads and trackers.
- **Cromite was the obvious alternative and does not work here: it requires
  Android 10+.** Mull is discontinued. Fennec's F-Droid listing states
  "requires Android 8.0 or newer", so Android 9 is fine.
- It is honestly *heavy* for 2 GB — Gecko is not small. Install uBlock Origin
  first thing and keep few tabs open.
- `/system` has 476 MB free, so the 116 MB APK costs otherwise-idle partition
  space rather than your `/data`.
- Don't want it? `python build_rom.py --no-browser` keeps Via and skips the
  download.

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
