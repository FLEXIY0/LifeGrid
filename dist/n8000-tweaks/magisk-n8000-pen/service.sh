#!/system/bin/sh
# Wacom G5SP digitizer tuning for the GT-N8000.
#
# The driver publishes 18 attributes under /sys/class/sec/sec_epen/
# (drivers/input/touchscreen/wacom/wacom_i2c.c:1520-1526, device "sec_epen"),
# and the ROM leaves all of them at firmware defaults. Two are worth setting.
#
# Everything here is a sysfs write - a reboot restores stock behaviour, and
# removing the module makes that permanent.

# ---- tune this -------------------------------------------------------------
# Pen polling rate in Hz. The driver accepts ONLY these values
# (epen_sampling_rate_store: case 0 / 40 / 80 / 133, everything else is
# rejected with count = -1), so do not invent numbers:
#     0   stop sampling      40  low
#     80  typical default    133 maximum - smoothest strokes
# 133 costs battery while the pen is in use. Drop to 80 if you don't draw.
PEN_RATE=133

# Power the digitizer down while the pen sits in its silo. The driver does
#   if (battery_saving_mode && pen_insert) wacom_i2c_disable()
# so with 0 the digitizer stays powered even with the pen stowed.
PEN_SAVING=1
# ----------------------------------------------------------------------------

until [ "$(getprop sys.boot_completed)" = "1" ]; do sleep 2; done
sleep 10

EPEN=/sys/class/sec/sec_epen

if [ ! -d "$EPEN" ]; then
    # Older/other kernels expose it elsewhere; try the generic sec class path.
    for C in /sys/devices/virtual/sec/sec_epen /sys/class/sec/sec_epen; do
        [ -d "$C" ] && { EPEN="$C"; break; }
    done
fi
[ -d "$EPEN" ] || exit 0

case "$PEN_RATE" in
    0|40|80|133)
        [ -w "$EPEN/epen_sampling_rate" ] && \
            echo "$PEN_RATE" > "$EPEN/epen_sampling_rate" 2>/dev/null
        ;;
esac

case "$PEN_SAVING" in
    0|1)
        [ -w "$EPEN/epen_saving_mode" ] && \
            echo "$PEN_SAVING" > "$EPEN/epen_saving_mode" 2>/dev/null
        ;;
esac
