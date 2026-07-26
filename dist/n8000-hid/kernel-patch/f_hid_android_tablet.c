/*
 * HID report descriptor for an absolute-position pen tablet (digitizer).
 *
 * Added alongside the keyboard and mouse descriptors this kernel already
 * carries (f_hid_android_keyboard.c, f_hid_android_mouse.c). The mouse is a
 * RELATIVE pointing device and cannot express "the pen is at X,Y pressing this
 * hard" - which is the whole point of a graphics tablet, hence a third device.
 *
 * This is a standard HID Digitizers/Pen collection, the same shape Windows Ink,
 * macOS and the Linux hid-generic driver all understand natively. No host-side
 * driver or helper application is needed anywhere.
 *
 * Report layout, 7 bytes, matching report_length below:
 *
 *   byte 0   bit 0  Tip Switch     (pen touching the surface)
 *            bit 1  Barrel Switch  (side button)
 *            bit 2  Eraser         (pen inverted - BTN_TOOL_RUBBER)
 *            bit 3  In Range       (pen detected, hovering or touching)
 *            bits 4-7  padding
 *   bytes 1-2  X        little endian, 0..32767
 *   bytes 3-4  Y        little endian, 0..32767
 *   bytes 5-6  Pressure little endian, 0..1023
 *
 * X and Y are reported in a normalised 0..32767 space rather than the panel's
 * native resolution, so the host does not need to know anything about this
 * particular digitizer. The userspace bridge rescales.
 *
 * Pressure keeps the digitizer's real 0..1023 range (WACOM_MAX_PRESSURE), so
 * no precision is thrown away on the way out.
 */

#include <linux/platform_device.h>
#include <linux/usb/g_hid.h>

/* HID descriptor for an absolute pen digitizer */
static struct hidg_func_descriptor ghid_device_android_tablet = {
	.subclass		= 0, /* No boot interface - digitizers have none */
	.protocol		= 0,
	.report_length		= 7,
	.report_desc_length	= 67,
	.report_desc = {
		0x05, 0x0D,        /* Usage Page (Digitizers)              */
		0x09, 0x02,        /* Usage (Pen)                          */
		0xA1, 0x01,        /* Collection (Application)             */
		0x09, 0x20,        /*   Usage (Stylus)                     */
		0xA1, 0x00,        /*   Collection (Physical)              */
		0x09, 0x42,        /*     Usage (Tip Switch)               */
		0x09, 0x44,        /*     Usage (Barrel Switch)            */
		0x09, 0x45,        /*     Usage (Eraser)                   */
		0x09, 0x32,        /*     Usage (In Range)                 */
		0x15, 0x00,        /*     Logical Minimum (0)              */
		0x25, 0x01,        /*     Logical Maximum (1)              */
		0x75, 0x01,        /*     Report Size (1)                  */
		0x95, 0x04,        /*     Report Count (4)                 */
		0x81, 0x02,        /*     Input (Data,Var,Abs)             */
		0x95, 0x04,        /*     Report Count (4)   - padding     */
		0x81, 0x03,        /*     Input (Cnst,Var,Abs)             */
		0x05, 0x01,        /*     Usage Page (Generic Desktop)     */
		0x09, 0x30,        /*     Usage (X)                        */
		0x09, 0x31,        /*     Usage (Y)                        */
		0x16, 0x00, 0x00,  /*     Logical Minimum (0)              */
		0x26, 0xFF, 0x7F,  /*     Logical Maximum (32767)          */
		0x75, 0x10,        /*     Report Size (16)                 */
		0x95, 0x02,        /*     Report Count (2)                 */
		0x81, 0x02,        /*     Input (Data,Var,Abs)             */
		0x05, 0x0D,        /*     Usage Page (Digitizers)          */
		0x09, 0x30,        /*     Usage (Tip Pressure)             */
		0x15, 0x00,        /*     Logical Minimum (0)              */
		0x26, 0xFF, 0x03,  /*     Logical Maximum (1023)           */
		0x75, 0x10,        /*     Report Size (16)                 */
		0x95, 0x01,        /*     Report Count (1)                 */
		0x81, 0x02,        /*     Input (Data,Var,Abs)             */
		0xC0,              /*   End Collection                     */
		0xC0               /* End Collection                       */
	}
};
