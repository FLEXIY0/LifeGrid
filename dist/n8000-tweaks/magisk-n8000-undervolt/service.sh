#!/system/bin/sh
# Relative CPU undervolt for the Exynos 4412 in the GT-N8000.
#
# WHY THIS IS SAFE (verified in the kernel source, not assumed):
#
#   arch/arm/mach-exynos/cpufreq.c  -> show_UV_mV_table() / store_UV_mV_table()
#   drivers/cpufreq/cpufreq.c:656   -> cpufreq_freq_attr_rw(UV_mV_table)
#
#   * store_UV_mV_table() CLAMPS every value it is given:
#       CPU_UV_MV_MIN = 600000 uV   CPU_UV_MV_MAX = 1500000 uV
#       (include/linux/cpufreq.h:28-29)
#     so an out-of-range number cannot reach the PMIC.
#   * it also rounds each value to the PMIC's 12.5 mV step.
#   * the table lives in RAM only — it is NOT written to the device. A reboot
#     always restores the stock, ASV-calibrated voltages.
#
#   Worst realistic case is an unstable freeze; hold power to reboot and the
#   stock table is back. Removing this module makes that permanent.
#
# WHY THE OFFSET IS RELATIVE:
#   Exynos uses ASV (Adaptive Supply Voltage) — every individual chip is
#   calibrated at the factory to different voltages depending on silicon
#   quality. Writing absolute voltages copied from someone else's tablet is
#   exactly how people make their device unstable. This script reads YOUR
#   chip's table and subtracts a fixed offset from it.

# ---- tune this -------------------------------------------------------------
# Start at 25. If it survives a few days, try 50. Back off on any freeze,
# random reboot or app crash under load. Above ~75 this SoC rarely stays sane.
UV_OFFSET_MV=25
# ----------------------------------------------------------------------------

LOG=/data/local/tmp/n8000_undervolt.log

until [ "$(getprop sys.boot_completed)" = "1" ]; do sleep 2; done
sleep 20   # let boot-time dexopt/scan settle before touching voltages

NODE=""
for C in /sys/devices/system/cpu/cpu0/cpufreq/UV_mV_table \
         /sys/devices/system/cpu/cpufreq/UV_mV_table; do
    [ -f "$C" ] && { NODE="$C"; break; }
done

if [ -z "$NODE" ]; then
    echo "$(date): no UV_mV_table on this kernel — nothing done" >> "$LOG"
    exit 0
fi

# show_UV_mV_table() prints one line per level: "1400mhz: 1300 mV"
BEFORE=$(cat "$NODE" 2>/dev/null)
echo "$(date): before" >> "$LOG"; echo "$BEFORE" >> "$LOG"

# Build the new list: same count, same order, each value minus the offset.
NEW=$(echo "$BEFORE" | awk -v off="$UV_OFFSET_MV" '
    /mV/ { v = $2 + 0; if (v > 0) { nv = v - off; printf "%d ", nv } }
')

if [ -z "$NEW" ]; then
    echo "$(date): could not parse table — aborted" >> "$LOG"
    exit 0
fi

echo "$NEW" > "$NODE" 2>/dev/null

echo "$(date): applied -${UV_OFFSET_MV}mV" >> "$LOG"
cat "$NODE" >> "$LOG" 2>/dev/null
