# Exhaustive audit — every property, every tunable

Two passes that are tedious by hand and trivial to automate. Both were run
against the shipped image, not against documentation.

## Pass 1 — is every property in this ROM actually read by anything?

A property only does something if some binary looks up that exact string.
Instead of checking a handful by hand, check **all 166 at once** in a single
scan of the 1.4 GB image:

```bash
grep -hoE "^[a-zA-Z][a-zA-Z0-9._-]*=" system/build.prop rd/default.prop \
  | sed 's/=$//' | sort -u > props.txt          # 166 properties
grep -a -o -F -f props.txt system.img | sort | uniq -c | sort -rn
```

One pass, 6.6 seconds. For a property defined in `build.prop` (which lives
*inside* the image), a count of **1** means the only occurrence is its own
definition — nothing reads it.

### Result: 36 of 123 `build.prop` properties are dead

The striking part is *which* ones. The maintainer's entire `# RAM optimizations`
block is inert on Android 9:

```
config.disable_atlas              persist.sys.purgeable_assets
persist.sys.force_highendgfx      ro.HOME_APP_ADJ
ro.sys.fw.use_trim_settings       ro.sys.fw.trim_enable_memory
ro.sys.fw.trim_empty_percent      ro.sys.fw.trim_cache_percent
ro.sys.fw.empty_app_percent       ro.sys.fw.bservice_enable
ro.sys.fw.bservice_limit          ro.sys.fw.bservice_age
```

…as is the whole `ro.hwui.*` block (6 properties — HWUI dropped these cache
knobs in Android 9), plus `ro.lcd_min_brightness`, `persist.camera.HAL3.enabled`,
`debug.hwui.render_dirty_regions`, `ro.ril.def.agps.mode`, `pm.dexopt.shared`,
`dalvik.vm.dexopt-data-only` and others.

This is a classic "performance tweaks" block copied from forum posts of the
KitKat era. It survives in a lot of ROMs. None of it does anything here.

### The subtle part — a duplicated set where only one half is live

`ro.sys.fw.*` is dead, but the **`ro.vendor.qti.sys.fw.*`** variants occur 13
times: LineageOS carries the CAF process-management patches, so the framework
reads the qti-prefixed names even on Exynos.

The ROM sets **both**, with different values:

| Setting | dead (`ro.sys.fw.`) | **live (`ro.vendor.qti.sys.fw.`)** |
|---|---|---|
| `trim_cache_percent` | 50 | **100** |
| `trim_empty_percent` | 50 | **50** |
| `empty_app_percent` | 25 | **25** |
| `use_trim_settings` | true | **true** |

So the effective `trim_cache_percent` is **100**, not the 50 the maintainer
appears to have intended. Anyone tuning memory behaviour on this ROM has to
target the `ro.vendor.qti.` names — editing the plain ones changes nothing.

### Most-referenced properties (for orientation)

```
 18  ro.config.low_ram        13  ro.build.fingerprint
 16  ro.build.type            11  ro.build.version.release
 14  ro.product.model         10  ro.lineage.version
```

`ro.config.low_ram` being consulted in 18 places is why flipping it to `true`
is a product decision, not a tweak — it changes behaviour in many subsystems.

## Pass 2 — get the tunable keys from the framework, not from a blog

Android's idle subsystems are configured through `Settings.Global` strings
parsed by `KeyValueListParser`. The authoritative key lists are compiled into
`services.jar`, so extract them:

```bash
grep -rhoE '"[a-z_]+_constants"' smali/ | sort | uniq -c | sort -rn
```

Twelve tunable groups exist on this build, including `device_idle_constants`,
`alarm_manager_constants`, `battery_saver_constants`, `activity_manager_constants`,
`job_scheduler_constants`, `power_manager_constants` and `app_idle_constants`.

### The finding that matters: doze has two halves

`DeviceIdleController$Constants` accepts **28** keys. The widely-copied "doze
tweak" strings — including the first version in this kit — set only the *deep*
idle keys and leave the entire **light idle** family at stock:

```
light_after_inactive_to   light_pre_idle_to    light_idle_to
light_max_idle_to         light_idle_factor    min_light_maintenance_time
light_idle_maintenance_min_budget   light_idle_maintenance_max_budget
min_deep_maintenance_time  notification_whitelist_duration  wait_for_unlock
```

Deep doze requires the device to be **stationary for a long stretch**. A tablet
that gets picked up and put down all day mostly lives in *light* doze, which
starts shortly after the screen turns off. Tuning only deep doze optimises the
state the device is in least often. The battery module now sets both.

### Also newly tuned, from the same extraction

- **`alarm_manager_constants`** — App Standby bucket delays
  (`standby_working_delay`, `standby_frequent_delay`, `standby_rare_delay`).
  Rarely-opened apps now wait hours instead of minutes before they may fire
  alarms.
- **`battery_saver_constants`** — defines what Battery Saver actually does:
  `force_all_apps_standby`, `force_background_check`, `optional_sensors_disabled`,
  `launch_boost_disabled`, and `gps_mode=1`, which powers the GPS radio down
  whenever the screen is off.

Every key used in the module was checked against these extracted lists.
`KeyValueListParser` silently ignores keys it does not recognise, so a typo
degrades to "no effect" rather than to breakage.
