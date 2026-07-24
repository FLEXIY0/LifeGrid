#!/system/bin/sh
# Does this kernel expose CPU undervolting, and what does the table look like?
#   adb shell < uv-check.sh
#
# Read-only. Changes nothing.

echo "=== cpufreq attributes ==="
ls /sys/devices/system/cpu/cpu0/cpufreq/ 2>/dev/null

echo
echo "=== UV_mV_table ==="
FOUND=0
for C in /sys/devices/system/cpu/cpu0/cpufreq/UV_mV_table \
         /sys/devices/system/cpu/cpufreq/UV_mV_table; do
    if [ -f "$C" ]; then
        FOUND=1
        echo "node: $C"
        cat "$C"
        echo "writable: $([ -w "$C" ] && echo yes || echo 'no (need root)')"
    fi
done
[ "$FOUND" = 0 ] && echo "not present — this kernel has no sysfs undervolt interface"

echo
echo "=== governor + available governors ==="
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors 2>/dev/null

echo
echo "=== pegasusq present? ==="
[ -d /sys/devices/system/cpu/cpufreq/pegasusq ] \
    && echo "yes — hotplug governor active" \
    || echo "no"

echo
echo "=== frequencies ==="
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_frequencies 2>/dev/null

echo
echo "=== zram ==="
cat /proc/swaps 2>/dev/null

echo
echo "=== cpuidle: is AFTR enabled? (2 = LPA only, 3 = AFTR+LPA) ==="
cat /sys/module/cpuidle_exynos4/parameters/enable_mask 2>/dev/null \
    || echo "node absent"

echo
echo "=== Mali GPU DVFS ==="
echo "control : $(cat /sys/module/mali/parameters/mali_dvfs_control 2>/dev/null || echo absent)"
echo "clock   : $(cat /sys/module/mali/parameters/mali_gpu_clk 2>/dev/null || echo n/a)"
echo "voltage : $(cat /sys/module/mali/parameters/mali_gpu_vol 2>/dev/null || echo n/a)"
cat /sys/bus/platform/devices/mali_dev.0/time_in_state 2>/dev/null

echo
echo "=== I/O scheduler (want [row]) ==="
cat /sys/block/mmcblk0/queue/scheduler 2>/dev/null
echo "read_ahead_kb : $(cat /sys/block/mmcblk0/queue/read_ahead_kb 2>/dev/null)"
echo "clkgate_delay : $(cat /sys/class/mmc_host/mmc0/clkgate_delay 2>/dev/null || echo n/a)"

echo
echo "=== f2fs tunables ==="
for F in /sys/fs/f2fs/*; do
    [ -d "$F" ] || continue
    echo "$F  ipu_policy=$(cat "$F/ipu_policy" 2>/dev/null) gc_idle=$(cat "$F/gc_idle" 2>/dev/null)"
done

echo
echo "=== busfreq (thresholds only; no volt tables on this kernel) ==="
for B in /sys/devices/platform/exynos-busfreq /sys/devices/platform/busfreq; do
    [ -d "$B" ] && ls "$B" 2>/dev/null
done

echo
echo "=== lowmemorykiller ==="
echo "minfree : $(cat /sys/module/lowmemorykiller/parameters/minfree 2>/dev/null)"
echo "adj     : $(cat /sys/module/lowmemorykiller/parameters/adj 2>/dev/null)"

echo
echo "=== thermal (read-only) ==="
cat /sys/devices/platform/s5p-tmu/curr_temp 2>/dev/null || echo n/a
