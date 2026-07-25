# Input Device Configuration for the GT-N8000's Wacom G5SP EMR digitizer.
#
# Replaces the stock file, which was only two lines:
#
#     touch.deviceType = pointer
#     touch.orientationAware = 1
#
# The filename matches the name the driver registers
# (drivers/input/touchscreen/wacom/wacom_i2c.c:556  input_dev->name = "sec_e-pen"),
# so this file really is the one Android applies to the pen.
#
# WHAT WAS WRONG
#
# 1. deviceType = pointer describes an *indirect* pointing device - a mouse or
#    trackpad. Android draws a cursor for it and reports it to apps as such.
#    This hardware is an absolute-position stylus digitizer, which Android has a
#    dedicated device type for. With "pointer", apps checking for
#    MotionEvent.TOOL_TYPE_STYLUS do not see a stylus, and you get a mouse
#    cursor following the pen - the complaint that shows up in Lineage threads
#    for this device.
#
# 2. There was no pressure calibration at all, even though the driver publishes
#    ABS_PRESSURE over 0..1023 (wacom_i2c.c:1470, WACOM_MAX_PRESSURE = 1023 in
#    include/linux/wacom_i2c.h). Rather than rely on whatever default Android
#    picks, the scale is stated explicitly: 1/1023 = 0.000978, so full physical
#    pressure maps to 1.0.
#
#    Note for anyone copying the widely-shared XDA value 0.000244 - that is
#    1/4096, correct for digitizers with 4096 pressure levels. This one has
#    1024, so 0.000244 would leave you using a quarter of the range.

touch.deviceType = stylus
touch.orientationAware = 1

pressure.calibration = physical
pressure.scale = 0.000978
