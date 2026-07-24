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

| # | Finding (from the image) | Change | Why it matters |
|---|--------------------------|--------|----------------|
| 1 | `ro.lcd_min_brightness=20` | → `4` | Backlight dominates power draw on this LCD. The floor is set higher than the panel needs, so the dim end of the slider is wasted. Biggest single battery lever here. |
| 2 | `ro.lmk.upgrade_pressure=40` (AOSP default 60) | → `60` | lmkd escalates kills at 40 % pressure — on 2 GB **with zram already active**, apps die while compressed RAM is still available. This is the main cause of "everything reloads when I switch apps". |
| 3 | `dalvik.vm.dex2oat-threads=1` on a quad-core SoC | → `2` | Single-threaded dexopt makes installs and post-update compilation crawl. Two threads keeps peak RAM bounded. |
| 4 | zram fixed at 400 MB | → `768 MB` | 400 MB is conservative for 2 GB. Battery module resizes at boot. |
| 5 | `ro.hwui.texture_cache_size=8` | → `16` | The whole hwui block is a low-RAM **phone** profile applied to a 1280×800 tablet; an 8 MB texture cache evicts and re-uploads constantly, burning GPU time. |
| 6 | `wifi.supplicant_scan_interval` effectively 180 | → `300` | Less idle radio wake-up. |
| 7 | No aggressive Doze config | `device_idle_constants` | Set at runtime by the battery module — Doze is a Settings value, **not** a build.prop property. |

## Cosmetic / dead weight (flagged, deliberately not "fixed")

Changing these buys nothing, so the kit leaves them alone:

- **Qualcomm properties on an Exynos device**: `ro.vendor.qti.am.reschedule_service`,
  `ro.vendor.qti.sys.fw.*`, `persist.camera.HAL3.enabled=1`. Copy-paste from a
  Snapdragon tree; inert on Exynos 4412.
- **`persist.sys.force_highendgfx=true`** is commented "force high-end graphics
  in low ram mode", but `ro.config.low_ram=false` — so it does nothing.
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
