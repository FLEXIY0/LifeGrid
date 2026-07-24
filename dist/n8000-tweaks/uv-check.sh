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
