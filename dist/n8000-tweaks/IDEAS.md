# What *can* still be upgraded in plus on a GT-N8000

The hardware ceiling is fixed: 2 GB soldered RAM, Exynos 4412, Mali-400,
Wi-Fi b/g/n, Widevine L3. None of that moves. But "the tablet is maxed out" is
only true if you assume it must keep being a general-purpose Android tablet.
Three angles genuinely add capability.

---

## 1. The one piece of hardware that is still world-class: the pen

The Note 10.1 does not use a cheap capacitive stylus — it has a **Wacom EMR
digitizer** with real pressure levels and no battery in the pen. That subsystem
is as good today as it was in 2012, because pen digitizers stopped improving.
The rest of the tablet aged; the pen did not.

Which means the highest-value upgrade is to stop asking the CPU to do work:

Concretely, from the kernel source: the digitizer is a **Wacom G5SP**
(`CONFIG_EPEN_WACOM_G5SP=y`) reporting **1024 pressure levels**
(`WACOM_MAX_PRESSURE = 1023`) and able to sample at up to **133 Hz**.

**The stock ROM under-configures it, and that is now fixed** — see
`../n8000-rom/patch/sec_e-pen.idc`. The shipped
`/system/usr/idc/sec_e-pen.idc` declared `touch.deviceType = pointer`, i.e.
Android treated an absolute-position stylus digitizer as a *mouse*, and set no
pressure calibration at all. The ROM patch corrects both. Fix that first —
otherwise everything below is working against a mis-declared input device.

- **Use it as a pressure-sensitive graphics tablet for your PC.** Options, with
  the caveat that none were tested on Android 9 here:
  - **VirtualTablet** — advertises Wacom-digitizer Galaxy Note support with
    pressure; needs a small server on the PC.
  - **Weylus** — **no app to install**: it serves a page you open in the
    tablet's browser. Pressure and multi-touch only when the host is Linux;
    other hosts still get low-latency absolute pen tracking.
  - **GfxTablet** — unmaintained upstream; several forks exist.
  A comparable standalone Wacom still costs real money, and the tablet does
  almost no computing in this role — the PC does — so weak silicon stops
  mattering.
- **Note-taking / PDF markup / sheet music.** Local, offline, no services
  needed. This is the workload it is still genuinely good at.
- **Pen tuning** lives in `magisk-n8000-pen/`: 133 Hz sampling, plus powering
  the digitizer down while the pen is docked in its silo (the ROM leaves it
  powered).

## 2. Make the network do the computing

The SoC is slow, but the Wi-Fi and the **hardware H.264 decoder** still work.
Anything you can turn into "decode a video stream" runs well:

- **Moonlight** (with Sunshine/GeForce Experience on a PC) — stream full desktop
  apps and games. The tablet decodes H.264 in hardware and sends touch/pen
  input back. A 2012 tablet running modern software, at native smoothness.
- **Second monitor** for the PC — *spacedesk* or *Deskreen*.
- **Remote desktop / VNC / SSH** — with the pen, a surprisingly good sysadmin
  console.
- **Jellyfin/Plex client**, but force **direct play** of H.264 files. Anything
  that makes the tablet software-decode (H.265/VP9/AV1) will crawl — transcode
  on the server instead.

## 3. Give it one job and let it run forever

Most of the battery and RAM pressure comes from being a general-purpose device.
Dedicate it and the constraints disappear:

- **Home Assistant / smart-home wall panel** — wall-mounted, permanently on
  charge, one kiosk app.
- **Photo frame / recipe screen / workshop manual** — always-on, zero apps.
- **Dashboard**: clock, weather, calendar, transit, server status.
- **E-reader** — the 1280×800 PLS panel is still perfectly pleasant for books.

---

## Software wins that are real, and already applied here

| Win | Where | Why it works |
|-----|-------|--------------|
| zRAM raised 400 MB → 768 MB | battery module | ROM already wires zram in fstab; more compressed RAM = far fewer app kills on 2 GB |
| Gentle CPU governor | battery module | avoids racing to max clock for trivial work |
| Aggressive Doze | battery module | the single biggest idle-drain lever on Android 9 |
| Full AOT compile | `extras.sh` | removes JIT work at runtime — faster launches, less CPU |
| Reduced animations | `extras.sh` | Mali-400 spends real time on compositing |
| DNS-level ad blocking | *AdAway*, or Private DNS | fewer requests parsed and rendered = measurably faster browsing **and** less radio time. On a slow CPU this is one of the largest perceived speedups available |
| Sub-minimum backlight | *screen dimmer* app | the LCD backlight is the #1 consumer; the hardware minimum is brighter than you need at night |
| One lightweight browser | Fennec + uBlock, or Cromite | modern JS is what actually kills this CPU, not the OS |

**Already optimal, don't bother:** `/data` and `/cache` are **already f2fs** in
this ROM (checked in the image) — the usual "convert to f2fs for worn eMMC"
advice is a no-op here.

## The only physical upgrades worth money

1. **A new battery.** ~13-year-old cells have lost most of their capacity. No
   amount of Doze fixes chemistry. This is the single biggest real-world gain.
2. **A fast microSD (UHS-I).** Cannot host apps usefully, but makes it a fine
   media/document device and takes pressure off the worn eMMC.
3. **A 2 A charger.** The tablet negotiates 2 A; a phone charger will take all
   night.

## What stays impossible

RAM, CPU/GPU, Wi-Fi standard, Widevine level, Mali blob versions, kernel major
version, and vendor security patches. Those are silicon and abandoned
proprietary code — software cannot add what the hardware does not have.
