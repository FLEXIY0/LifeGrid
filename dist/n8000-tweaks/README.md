# GT-N8000 tweak kit (LineageOS 16 / Android 9)

Systemless, reversible battery & lightness tweaks for the Samsung Galaxy Note 10.1
(GT-N8000). Built for the `html6405` LineageOS 16.0 build, which already ships
Magisk baked in — so everything here is applied as Magisk modules / runtime
commands. **Nothing repacks or re-signs the ROM. No brick risk. Every change
reverts by removing the module (or running the restore script) and rebooting.**

## Contents

| Item | What it does | How to apply |
|------|--------------|--------------|
| `magisk-n8000-battery/` | gentle CPU governor, zRAM 400→768 MB, VM tuning, aggressive Doze, boot-time `fstrim` | flash as Magisk module |
| `magisk-n8000-props/` | systemless `build.prop` overrides that actually matter on A9 (less Wi-Fi scanning, less logging) | flash as Magisk module |
| `extras.sh` | full AOT compile, reduced animations, Wi-Fi power saving, fstrim | `adb shell < extras.sh` |
| `debloat.sh` | removes unused system apps **per-user** (APK stays in ROM) | `adb shell < debloat.sh` |
| `restore-debloat.sh` | undoes the debloat | `adb shell < restore-debloat.sh` |
| `microg/` | microG guidance + fetcher — **read it first, it may not be worth installing** | see `microg/README.md` |
| `IDEAS.md` | what can still genuinely be upgraded on this hardware | reading |

## What was verified inside the ROM image

These are not guesses — the `lineage-16.0-20201207-HTML6405-n8000.zip` image was
unpacked (brotli → `sdat2img` → ext4, read with `debugfs`) and checked:

- **Magisk is already baked into `/system/app`** — the device is rooted out of
  the box, so everything here can be systemless.
- **zRAM is already active out of the box**: `init.target.rc` calls
  `swapon_all` unconditionally and the fstab defines zram0 at 400 MB
  (`zramsize=419430400`). Nothing gates it — the battery module simply grows
  it to 768 MB.
- **`/data` and `/cache` are already f2fs** — the common "convert to f2fs"
  advice is a no-op on this build.
- **No signature spoofing**: `framework-res.apk` has no
  `FAKE_PACKAGE_SIGNATURE`, so microG needs the NanoDroid patcher. See
  `microg/README.md`.
- **No GApps and no Google Play Services at all** in the ROM — it is already
  the lightest possible baseline.
- The kernel is LZO-compressed, so its governor list can't be read statically;
  the battery module therefore picks the first governor the running kernel
  actually offers (`conservative` → `ondemand` → `powersave`) and no-ops if
  none exist.

## Install the Magisk modules

Each module folder must be zipped **with its files at the zip root** (not nested
in the folder), then flashed in the Magisk app → Modules → Install from storage.

```bash
cd magisk-n8000-battery && zip -r ../n8000-battery.zip . && cd ..
cd magisk-n8000-props   && zip -r ../n8000-props.zip   . && cd ..
# copy the two zips to the tablet, flash in Magisk, reboot
```

Or push straight into Magisk's module dir over ADB (device rooted):

```bash
adb push magisk-n8000-battery /data/adb/modules/n8000_battery
adb push magisk-n8000-props   /data/adb/modules/n8000_props
adb shell chmod 0755 /data/adb/modules/n8000_battery/service.sh
adb reboot
```

## Verify after reboot

```bash
adb shell cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor   # -> conservative
adb shell "free -m; cat /proc/swaps"                                  # zram active
adb shell settings get global device_idle_constants                  # aggressive doze string
adb shell getprop wifi.supplicant_scan_interval                      # -> 180
```

## Note on "aggressive Doze" and "background limit"

These are **not** build.prop properties — they live in `Settings.Global`, so the
battery module sets Doze via `settings put global device_idle_constants`.
The "Background process limit" is a Developer-Options toggle with no reliable
persistent settings key on Android 9 — set it by hand:
**Settings → Developer options → Background process limit → "At most 2 processes".**
