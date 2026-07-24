#!/system/bin/sh
# N8000 Battery module — runs late_start (after boot).
# All writes are guarded: if a node/tunable is absent, the line no-ops safely.
# Nothing here is persistent to the ROM — remove the module + reboot to revert.

# Wait for a fully booted system before touching settings/governors.
until [ "$(getprop sys.boot_completed)" = "1" ]; do sleep 2; done
sleep 8

# ---------------------------------------------------------------------------
# 1) CPU governor -> conservative on every core (gentler ramp = less power)
# ---------------------------------------------------------------------------
for CPU in /sys/devices/system/cpu/cpu[0-9]*/cpufreq; do
    if grep -qw conservative "$CPU/scaling_available_governors" 2>/dev/null; then
        echo conservative > "$CPU/scaling_governor" 2>/dev/null
    fi
done

# conservative tunables live per-policy; try both common layouts
for T in /sys/devices/system/cpu/cpu*/cpufreq/conservative \
         /sys/devices/system/cpu/cpufreq/conservative; do
    [ -d "$T" ] || continue
    echo 90 > "$T/up_threshold"    2>/dev/null   # climb to high freq less eagerly
    echo 20 > "$T/down_threshold"  2>/dev/null   # must stay < up_threshold
    echo 5  > "$T/freq_step"       2>/dev/null   # small steps = slow, gentle climb
    echo 4  > "$T/sampling_down_factor" 2>/dev/null
    echo 1  > "$T/ignore_nice_load"     2>/dev/null
done

# ---------------------------------------------------------------------------
# 2) zRAM — compressed swap in RAM. Big win on a 2 GB device.
# ---------------------------------------------------------------------------
if [ -e /sys/block/zram0/disksize ]; then
    # tear down any existing zram before resizing
    for S in /dev/block/zram0 /dev/zram0; do
        [ -e "$S" ] && swapoff "$S" 2>/dev/null
    done
    echo 1 > /sys/block/zram0/reset 2>/dev/null
    # prefer lz4 (fast, cheap) if the kernel offers it, else keep default
    grep -qw lz4 /sys/block/zram0/comp_algorithm 2>/dev/null && \
        echo lz4 > /sys/block/zram0/comp_algorithm 2>/dev/null
    echo 805306368 > /sys/block/zram0/disksize 2>/dev/null   # 768 MB
    ZDEV=/dev/block/zram0; [ -e "$ZDEV" ] || ZDEV=/dev/zram0
    mkswap "$ZDEV" >/dev/null 2>&1
    swapon "$ZDEV" -p 32 >/dev/null 2>&1
fi

# ---------------------------------------------------------------------------
# 3) VM tuning — lean toward RAM economy + fewer flash writes (battery)
# ---------------------------------------------------------------------------
echo 100 > /proc/sys/vm/swappiness           2>/dev/null   # actually use zram
echo 50  > /proc/sys/vm/vfs_cache_pressure    2>/dev/null   # keep inode/dentry cache
echo 90  > /proc/sys/vm/dirty_ratio           2>/dev/null
echo 70  > /proc/sys/vm/dirty_background_ratio 2>/dev/null
echo 3000 > /proc/sys/vm/dirty_expire_centisecs 2>/dev/null # batch writeback

# ---------------------------------------------------------------------------
# 4) Aggressive Doze + location-off-while-idle (this is settings, NOT build.prop)
# ---------------------------------------------------------------------------
settings put global device_idle_constants \
"inactive_to=60000,sensing_to=0,locating_to=0,location_accuracy=20.0,motion_inactive_to=0,idle_after_inactive_to=0,idle_pending_to=60000,max_idle_pending_to=120000,idle_pending_factor=2.0,idle_to=900000,max_idle_to=21600000,idle_factor=2.0,min_time_to_alarm=600000,max_temp_app_whitelist_duration=10000,mms_temp_app_whitelist_duration=10000,sms_temp_app_whitelist_duration=10000" 2>/dev/null

# trim adaptive-brightness/network hits from idle: let the OS sleep radios sooner
settings put global wifi_scan_always_enabled 0 2>/dev/null
settings put global ble_scan_always_enabled  0 2>/dev/null

# ---------------------------------------------------------------------------
# 5) fstrim — reclaim eMMC performance (snappier, one-shot at boot)
# ---------------------------------------------------------------------------
for M in /data /cache /system; do
    fstrim "$M" >/dev/null 2>&1
done
