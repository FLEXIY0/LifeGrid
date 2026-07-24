# ROM audit — lineage-16.0-20201207-HTML6405-n8000

Everything here comes from reading the shipped image, not from guesswork:

```
zip -> system.new.dat.br --brotli--> system.new.dat --sdat2img--> system.img (ext4)
     -> debugfs                                    (app list, framework, build.prop)
boot.img -> header parse -> kernel.bin (LZO, opaque) + ramdisk (gzip+cpio)
                                        -> init*.rc, fstab.smdk4x12, default.prop
```

## What the maintainer got right

Worth saying plainly — this is a well-built ROM, not a sloppy one:

- `ro.zygote.disable_gl_preload=1`, `config.disable_atlas=true`,
  `persist.sys.purgeable_assets=1` — sensible RAM savings for 2 GB.
- `ro.statsd.enable=false` — telemetry daemon off.
- `dalvik.vm.systemservercompilerfilter=speed` — system_server fully compiled.
- `/data` and `/cache` are **f2fs**, not ext4 — correct choice for worn eMMC.
- **zram is enabled unconditionally**: `init.target.rc:103` calls
  `swapon_all /fstab.smdk4x12`, and the fstab defines
  `/dev/block/zram0 … zramsize=419430400` (400 MB). No property gates it.
- Magisk is baked into `/system/app`, so the device is rooted out of the box.
- `ro.egl.destroy_after_detach=true` — works around a real Mali blob crash.

## What is left un-tuned, and what this kit does about it

## Verification method — does anything actually *read* the property?

A build.prop line only does something if some binary looks it up. Counting how
often a property name occurs in the whole 1.4 GB image separates real knobs
from decoration:

```bash
grep -a -o "ro\.lmk\.upgrade_pressure" system.img | wc -l   # 2 -> build.prop + lmkd  => REAL
grep -a -o "ro\.lcd_min_brightness"    system.img | wc -l   # 1 -> only build.prop    => DEAD
```

| Property | Occurrences | Verdict |
|----------|-------------|---------|
| `ro.lmk.upgrade_pressure` | 2 | real (lmkd reads it) |
| `dalvik.vm.dex2oat-threads` | 4 | real |
| `wifi.supplicant_scan_interval` | 7 | real |
| `ro.sys.fw.bg_apps_limit` | 3 | real |
| `ro.vendor.qti.sys.fw.*` | 13 | **real** — LineageOS carries the CAF patches, so the framework reads these even on Exynos |
| `ro.lcd_min_brightness` | 1 | **dead** |
| `ro.hwui.texture_cache_size` | 1 | **dead** (HWUI dropped these in Android 9) |
| `persist.sys.purgeable_assets` | 1 | dead |
| `persist.sys.force_highendgfx` | 1 | dead |

This pass removed two tweaks from an earlier version of this kit that looked
sensible but were writing to properties nobody reads.

## What is left un-tuned, and what this kit does about it

| # | Finding (from the image) | Change | Why it matters |
|---|--------------------------|--------|----------------|
| 1 | Governor is **pegasusq**, and the kit was switching it away | **keep pegasusq, tune it** | pegasusq does CPU **hotplug** — it parks idle cores, the biggest CPU-side saving on this quad-core. Switching to conservative/ondemand/powersave would have *lost* that. Now `up_threshold`, `freq_step`, `cpu_up/down_rate`, `io_is_busy`, `ignore_nice_load`, `sampling_rate` are tuned toward idling instead. |
| 2 | `ro.lmk.upgrade_pressure=40` (AOSP default 60) | → `60` + `kill_heaviest_task=true` | lmkd escalates kills at 40 % pressure — on 2 GB **with zram active**, apps die while compressed RAM still has headroom. Main cause of "everything reloads when I switch back". |
| 3 | `dalvik.vm.dex2oat-threads=1` on a quad-core SoC | → `2` | Single-threaded dexopt makes installs and post-update compilation crawl. |
| 4 | zram fixed at 400 MB | → `768 MB` | 400 MB is conservative for 2 GB. |
| 5 | **`read_ahead_kb` set twice, to different values**: 512 in `init.smdk4x12.rc`, 256 in `init.target.rc` | pinned to `128` | Whichever script runs last silently wins — a genuine conflict. Large read-ahead evicts useful page cache on a 2 GB device for data never used. |
| 6 | `wifi.supplicant_scan_interval` effectively 180 | → `300` | Less idle radio wake-up. |
| 7 | No aggressive Doze config | `device_idle_constants` | Doze is a Settings value, **not** a build.prop property. |
| 8 | **`gps.conf` lists the maintainer's Austrian NTP servers first** (`asynchronos.iiss.at`, `ntp.inode.at`, `*.at.pool.ntp.org`) | global `pool.ntp.org` first | GPS seeds its clock over NTP before a fix. Outside Austria those are avoidable round-trips — slower time-to-first-fix and longer radio-on. Replaced systemlessly; the rest of the file is byte-for-byte the original. |

## Cosmetic / dead weight (flagged, deliberately not "fixed")

Changing these buys nothing, so the kit leaves them alone:

- **Qualcomm-named properties**: `ro.vendor.qti.sys.fw.*` look like Snapdragon
  copy-paste, but they occur **13 times** in the image — LineageOS carries the
  CAF process-management patches, so the framework really does read them on
  Exynos too. They are doing their job; left alone.
  (`persist.camera.HAL3.enabled=1` genuinely is inert here.)
- **`persist.sys.force_highendgfx=true`** is commented "force high-end graphics
  in low ram mode", but `ro.config.low_ram=false` — and it occurs once, so
  nothing reads it anyway.
- **`AgpsServerIp=3232235555`** in `gps.conf` decodes to `192.168.1.35` — a LAN
  address left over from someone's bench. Harmless placeholder; kept as-is so
  the file stays otherwise identical to stock.
- **`ro.sys.fw.bg_apps_limit`** is set twice (32, then 16). Last wins; harmless.
- **`wifi.supplicant_scan_interval`** is likewise set twice (240, then 180).
- **`ro.config.small_battery=true`** on a ~7000 mAh tablet looks like a
  copy-paste artifact. Its practical effect on Android 9 is small and not
  worth the risk of changing blind, so it stays.

## Not changed on purpose

- **`ro.config.low_ram=false`** — flipping it to `true` would cut RAM use
  noticeably, but it also disables features and visibly changes UI behaviour.
  That is a product decision, not a fix; left to the user.
- **f2fs `discard` mount option** — continuous TRIM can stutter on aged eMMC,
  and `nodiscard` + periodic `fstrim` is usually better. Changing it means
  editing the fstab inside `boot.img` and re-flashing the kernel — real brick
  risk for a modest gain. The battery module runs `fstrim` at boot instead.
- **Kernel governors** — the kernel is LZO-compressed, so its governor list
  can't be read statically. The battery module probes the running kernel and
  falls back `conservative → ondemand → powersave`.

## Verify the changes actually landed

```bash
adb shell getprop ro.lcd_min_brightness        # 4
adb shell getprop ro.lmk.upgrade_pressure      # 60
adb shell getprop dalvik.vm.dex2oat-threads    # 2
adb shell getprop ro.hwui.texture_cache_size   # 16
adb shell "cat /proc/swaps"                    # zram0, ~768 MB
adb shell cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
```

`ro.*` properties are read once at process start, so reboot before testing.
If `ro.lmk.upgrade_pressure` still reads 40, lmkd started before Magisk's
post-fs-data stage — reboot once more and re-check.
