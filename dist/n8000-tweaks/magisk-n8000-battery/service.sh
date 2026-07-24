#!/system/bin/sh
# N8000 Battery module — runs late_start (after boot).
# Every write is guarded: if a node is absent the line no-ops safely.
# Nothing is persistent — remove the module and reboot to revert all of it.
#
# Tuning targets were taken from the ROM's own init scripts (init.target.rc
# chowns the pegasusq tunables; init.smdk4x12.rc and init.target.rc both set
# read_ahead_kb). See ../FINDINGS.md.

until [ "$(getprop sys.boot_completed)" = "1" ]; do sleep 2; done
sleep 8

# ---------------------------------------------------------------------------
# 1) CPU: tune pegasusq — do NOT switch governors.
#
#    This kernel's governor is pegasusq (Samsung's Exynos governor). It does
#    CPU hotplug: it parks idle cores entirely, which is the single biggest
#    CPU-side battery saver on this quad-core. Switching to conservative /
#    ondemand / powersave would LOSE hotplug and make battery worse, so the
#    governor is left alone and its knobs are tuned toward idling instead.
# ---------------------------------------------------------------------------
PQ=/sys/devices/system/cpu/cpufreq/pegasusq
if [ -d "$PQ" ]; then
    # Demand less eagerly: require sustained load before clocking up.
    echo 95    > "$PQ/up_threshold"      2>/dev/null   # default ~85
    echo 10    > "$PQ/down_differential" 2>/dev/null   # drop back down sooner
    echo 20    > "$PQ/freq_step"         2>/dev/null   # smaller steps, gentler ramp

    # Park unused cores faster. cpu_down_rate is how many sampling periods must
    # pass before a core is taken offline — lower means quicker to idle.
    echo 10    > "$PQ/cpu_down_rate"     2>/dev/null
    echo 20    > "$PQ/cpu_up_rate"       2>/dev/null   # slower to wake extra cores

    # Don't treat I/O wait as CPU load (stops needless clock-ups while reading
    # from eMMC), and ignore low-priority background work.
    echo 0     > "$PQ/io_is_busy"        2>/dev/null
    echo 1     > "$PQ/ignore_nice_load"  2>/dev/null

    # Sample slightly less often: fewer governor wake-ups while idle.
    echo 60000 > "$PQ/sampling_rate"     2>/dev/null

    # NOTE: hotplug_freq_* / hotplug_rq_* are deliberately NOT touched. Delaying
    # extra cores sounds like a saving, but it fights race-to-idle: one core
    # pinned at high clock can burn more than two cores finishing quickly and
    # sleeping. The stock thresholds are already sane.
else
    # Fallback only if this isn't the pegasusq kernel: pick a gentle governor
    # that actually exists, otherwise leave the default alone.
    for CPU in /sys/devices/system/cpu/cpu[0-9]*/cpufreq; do
        [ -f "$CPU/scaling_available_governors" ] || continue
        AVAIL=$(cat "$CPU/scaling_available_governors" 2>/dev/null)
        for G in conservative ondemand; do
            case " $AVAIL " in
                *" $G "*) echo "$G" > "$CPU/scaling_governor" 2>/dev/null; break ;;
            esac
        done
    done
fi

# ---------------------------------------------------------------------------
# 1b) cpuidle: turn AFTR back on.
#
#     enable_mask bits (arch/arm/mach-exynos/cpuidle-exynos4.c:105-107):
#       0x1 = AFTR (ARM off, top-run)   0x2 = LPA (low power audio)
#     The generic default is 3, but the file guards it with
#     #if defined(CONFIG_MACH_MIDAS) -> 2, and this device builds with
#     CONFIG_MACH_MIDAS=y. So AFTR ships DISABLED and the SoC never enters its
#     deepest idle state. This is the largest idle-battery lever found.
#
#     Wi-Fi-only tablet has no modem, which is where AFTR instability on 4412
#     is usually reported. Revert: echo 2 (or remove the module).
# ---------------------------------------------------------------------------
CPUIDLE=/sys/module/cpuidle_exynos4/parameters/enable_mask
[ -w "$CPUIDLE" ] && echo 3 > "$CPUIDLE" 2>/dev/null

# ---------------------------------------------------------------------------
# 1c) Mali-400 GPU DVFS step control.
#
#     /sys/module/mali/parameters/mali_dvfs_control (exynos4_pmm.c:254)
#       0   = normal automatic DVFS  (default, left alone here)
#       160/266/350/440/533 = PIN to the highest step <= this clock
#     Any other value matches no step and freezes the level - never use one.
#
#     Voltages still come from the ASV table, so pinning is safe. Set 160 for a
#     big idle/reading saving at the cost of frame rate; 533 for games.
# ---------------------------------------------------------------------------
MALI_DVFS=/sys/module/mali/parameters/mali_dvfs_control
MALI_STEP=0     # <- 0 auto | 160 battery | 533 performance
if [ -w "$MALI_DVFS" ]; then
    case "$MALI_STEP" in
        0|160|266|350|440|533) echo "$MALI_STEP" > "$MALI_DVFS" 2>/dev/null ;;
    esac
fi

# ---------------------------------------------------------------------------
# 2) zRAM — the ROM already brings zram0 up at 400 MB (fstab + unconditional
#    swapon_all in init.target.rc). Nothing to enable; just grow it to 768 MB,
#    which suits 2 GB better. Must swapoff before resizing.
# ---------------------------------------------------------------------------
if [ -e /sys/block/zram0/disksize ]; then
    for S in /dev/block/zram0 /dev/zram0; do
        [ -e "$S" ] && swapoff "$S" 2>/dev/null
    done
    echo 1 > /sys/block/zram0/reset 2>/dev/null
    grep -qw lz4 /sys/block/zram0/comp_algorithm 2>/dev/null && \
        echo lz4 > /sys/block/zram0/comp_algorithm 2>/dev/null
    echo 805306368 > /sys/block/zram0/disksize 2>/dev/null   # 768 MB
    ZDEV=/dev/block/zram0; [ -e "$ZDEV" ] || ZDEV=/dev/zram0
    mkswap "$ZDEV" >/dev/null 2>&1
    swapon "$ZDEV" -p 32 >/dev/null 2>&1
fi

# ---------------------------------------------------------------------------
# 3) Block layer: settle the read-ahead conflict.
#
#    init.smdk4x12.rc writes 512 KB and init.target.rc writes 256 KB to the
#    same node, so whichever runs last silently wins. On a 2 GB device large
#    read-ahead evicts useful page cache for data that is never used. Pin it
#    to a deterministic, modest value. (256 is also reasonable — edit freely.)
# ---------------------------------------------------------------------------
for Q in /sys/block/mmcblk*/queue; do
    [ -d "$Q" ] || continue
    echo 128 > "$Q/read_ahead_kb" 2>/dev/null
    # eMMC has no seek penalty and no useful reordering depth
    echo 0   > "$Q/rotational"    2>/dev/null
    echo 0   > "$Q/add_random"    2>/dev/null   # don't feed the entropy pool
    echo 0   > "$Q/iostats"       2>/dev/null   # per-request accounting overhead
    echo 128 > "$Q/nr_requests"   2>/dev/null

    # Fallback only: the scheduler is normally set via persist.sys.io.scheduler
    # (see magisk-n8000-props), which init applies ROM-natively to every block
    # device including the SD card. This catches the case where that failed.
    if [ -f "$Q/scheduler" ]; then
        case "$(cat "$Q/scheduler" 2>/dev/null)" in
            *"[cfq]"*)
                for S in row deadline noop; do
                    grep -q "$S" "$Q/scheduler" 2>/dev/null && \
                        { echo "$S" > "$Q/scheduler" 2>/dev/null; break; }
                done ;;
        esac
    fi
done

# eMMC clock gating delay (drivers/mmc/core/host.c:297). Default 3 ms; a longer
# delay means fewer clock on/off cycles under mixed load.
for H in /sys/class/mmc_host/mmc0/clkgate_delay; do
    [ -w "$H" ] && echo 10 > "$H" 2>/dev/null
done

# ---------------------------------------------------------------------------
# 3b) f2fs — /data and /cache are f2fs on this ROM, but its behaviour is stock.
#     Knobs come from fs/f2fs/ (ipu_policy, gc_*, ram_thresh, ...).
# ---------------------------------------------------------------------------
for F in /sys/fs/f2fs/*; do
    [ -d "$F" ] || continue
    # In-place updates cut write amplification: 0x2 = LOW_SPACE | 0x4 = UTIL
    echo 6     > "$F/ipu_policy"        2>/dev/null
    echo 70    > "$F/min_ipu_util"      2>/dev/null
    # Push garbage collection towards idle time instead of foreground writes
    echo 1     > "$F/gc_idle"           2>/dev/null
    echo 60000 > "$F/gc_min_sleep_time" 2>/dev/null
    echo 90000 > "$F/gc_max_sleep_time" 2>/dev/null
    echo 4     > "$F/max_small_discards" 2>/dev/null
done

# ---------------------------------------------------------------------------
# 3c) Memory-bus DVFS (busfreq). This branch exposes thresholds but NOT the
#     int/mif voltage tables, so bus undervolt is not available - only how
#     eagerly the bus clocks up. Higher thresholds = stays low longer.
# ---------------------------------------------------------------------------
for B in /sys/devices/platform/exynos-busfreq /sys/devices/platform/busfreq; do
    [ -d "$B" ] || continue
    echo 40 > "$B/up_threshold"      2>/dev/null
    echo 30 > "$B/idle_threshold"    2>/dev/null
    echo 12 > "$B/load_history_size" 2>/dev/null
done

# ---------------------------------------------------------------------------
# 3d) lowmemorykiller minfree, in 4 KB pages.
#     lmkd (userspace) writes these at start from ro.lmk.*, so this must run
#     AFTER it - which late_start + the boot wait above guarantees.
#     Values below keep more free memory for cache on a 2 GB device.
# ---------------------------------------------------------------------------
LMK=/sys/module/lowmemorykiller/parameters/minfree
[ -w "$LMK" ] && echo "12288,15360,18432,21504,24576,30720" > "$LMK" 2>/dev/null

# ---------------------------------------------------------------------------
# 4) VM tuning — lean toward RAM economy and fewer flash writes
# ---------------------------------------------------------------------------
echo 100  > /proc/sys/vm/swappiness              2>/dev/null   # actually use zram
echo 50   > /proc/sys/vm/vfs_cache_pressure      2>/dev/null
echo 90   > /proc/sys/vm/dirty_ratio             2>/dev/null
echo 70   > /proc/sys/vm/dirty_background_ratio  2>/dev/null
echo 3000 > /proc/sys/vm/dirty_expire_centisecs  2>/dev/null   # batch writeback

# ---------------------------------------------------------------------------
# 5) Idle behaviour. These are Settings values, NOT build.prop properties.
#
#    Every key below was extracted from THIS ROM's compiled framework rather
#    than copied from a guide:
#      DeviceIdleController$Constants, AlarmManagerService$Constants and
#      BatterySaverPolicy in services.jar (baksmali). Unknown keys are silently
#      ignored by KeyValueListParser, so a typo would just do nothing.
# ---------------------------------------------------------------------------

# 5a) DEEP doze — kicks in only once the tablet is genuinely stationary.
#     Most published "doze tweaks" stop here, which is why they underdeliver.
settings put global device_idle_constants \
"inactive_to=60000,sensing_to=0,locating_to=0,location_accuracy=20.0,motion_inactive_to=0,idle_after_inactive_to=0,idle_pending_to=60000,max_idle_pending_to=120000,idle_pending_factor=2.0,idle_to=900000,max_idle_to=21600000,idle_factor=2.0,min_time_to_alarm=600000,max_temp_app_whitelist_duration=10000,mms_temp_app_whitelist_duration=10000,sms_temp_app_whitelist_duration=10000,\
light_after_inactive_to=30000,light_pre_idle_to=60000,light_idle_to=300000,light_max_idle_to=900000,light_idle_factor=2.0,light_idle_maintenance_min_budget=30000,light_idle_maintenance_max_budget=120000,min_light_maintenance_time=10000,min_deep_maintenance_time=30000,notification_whitelist_duration=15000,wait_for_unlock=false" 2>/dev/null
#     ^ the light_* family is the half that actually governs a tablet which is
#       picked up and put down all day: deep doze needs long stillness, light
#       doze starts 30 s after the screen goes off.

# 5b) App Standby buckets — how long an app that you rarely open must wait
#     before its alarms may fire. Stock lets rare apps wake the device often.
settings put global alarm_manager_constants \
"min_futurity=10000,min_interval=60000,allow_while_idle_short_time=30000,allow_while_idle_long_time=1800000,standby_working_delay=3600000,standby_frequent_delay=14400000,standby_rare_delay=86400000" 2>/dev/null

# 5c) Make Battery Saver actually aggressive when you switch it on.
#     gps_mode=1 turns the GPS radio off entirely while the screen is off.
settings put global battery_saver_constants \
"force_all_apps_standby=true,force_background_check=true,optional_sensors_disabled=true,vibration_disabled=true,launch_boost_disabled=true,fullbackup_deferred=true,keyvaluebackup_deferred=true,adjust_brightness_disabled=false,adjust_brightness_factor=0.5,gps_mode=1" 2>/dev/null

settings put global wifi_scan_always_enabled 0 2>/dev/null
settings put global ble_scan_always_enabled  0 2>/dev/null

# 5d) Network statistics. NetworkStatsService polls and persists to /data on a
#     30-second cadence by default - a steady trickle of eMMC writes and
#     wakeups for data almost nobody reads. Keys taken from
#     com/android/server/net/NetworkStatsService.smali.
settings put global netstats_poll_interval        1800000 2>/dev/null
settings put global netstats_uid_persist_bytes    2097152 2>/dev/null
settings put global netstats_dev_persist_bytes    2097152 2>/dev/null
settings put global netstats_augment_enabled            0 2>/dev/null
settings put global netstats_sample_enabled             0 2>/dev/null

# 5e) Captive-portal probing fires on every Wi-Fi association. 0 disables it.
#     Set to 1 if you use public hotspots that need the login page to pop up.
settings put global captive_portal_mode 0 2>/dev/null

# 5f) Sync retries. exemption_temp_whitelist_duration_in_seconds is the window
#     during which a syncing app is lifted out of Doze - 600 s stock is huge.
settings put global sync_manager_constants \
"initial_sync_retry_time_in_seconds=60,retry_time_increase_factor=3.0,max_sync_retry_time_in_seconds=7200,max_retries_with_app_standby_exemption=2,exemption_temp_whitelist_duration_in_seconds=60" 2>/dev/null

# ---------------------------------------------------------------------------
# 5g) LineageOS-specific settings.
#
#     These live in the LineageSettings provider, not AOSP's, so `settings put`
#     alone may not reach them. Try both paths; whichever is wrong just fails
#     silently. All were confirmed present in the system image.
# ---------------------------------------------------------------------------
lput() {   # lput <namespace> <key> <value>
    settings put "$1" "$2" "$3" 2>/dev/null
    content insert --uri "content://lineagesettings/$1" \
        --bind name:s:"$2" --bind value:s:"$3" >/dev/null 2>&1
}

lput system wake_when_plugged_or_unplugged 0   # screen must not wake on charge
lput system system_profiles_enabled        0   # drops the ProfileManager service
lput system network_traffic_mode           0   # status-bar traffic meter polls
lput system volbtn_music_controls          0   # long-press polling on vol keys
lput system notification_light_pulse       0
lput system touchscreen_gesture_haptic_feedback 0

# ---------------------------------------------------------------------------
# 6) fstrim — /data and /cache are f2fs here; keep write performance up
# ---------------------------------------------------------------------------
for M in /data /cache; do
    fstrim "$M" >/dev/null 2>&1
done
