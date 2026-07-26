#!/usr/bin/env python3
"""Add the pen digitizer as a third HID gadget device to an Exynos 4412 kernel.

    python3 apply.py /path/to/kernel-source

Idempotent, and asserts on every edit: if the tree does not look the way this
patch expects, it stops rather than half-applying.

WHAT IS ALREADY THERE - and why this patch is small
---------------------------------------------------
This kernel already carries the HID gadget:

  drivers/usb/gadget/Makefile : g_android-y := android.o f_hid.o
  arch/.../defconfig          : CONFIG_USB_G_ANDROID=y
  drivers/usb/gadget/android.c: #include "f_hid_android_keyboard.c"
                                #include "f_hid_android_mouse.c"
                                hid_function is in supported_functions[]
                                with no #ifdef around it

So keyboard and mouse gadgets work on a stock build already - no rebuild needed
for those. CONFIG_USB_G_HID gates the *standalone* g_hid.o gadget, which is a
different thing and irrelevant here.

What is missing is an ABSOLUTE pointing device. The mouse descriptor is
relative, so it can say "moved 3 left" but never "the pen is here, pressing this
hard". This patch adds that third descriptor and binds it, giving /dev/hidg2.
"""

import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "f_hid_android_tablet.c")


def patch_android_c(path):
    text = open(path).read()
    original = text

    if "f_hid_android_tablet.c" in text:
        print("  android.c: already patched")
        return False

    # 1. include the new descriptor next to the existing two
    anchor = '#include "f_hid_android_mouse.c"'
    assert anchor in text, "cannot find the mouse include - unexpected tree"
    text = text.replace(anchor, anchor + '\n#include "f_hid_android_tablet.c"', 1)
    print("  android.c: added include")

    # 2. ask for three HID char devices instead of two
    old = "return ghid_setup(cdev->gadget, 2);"
    assert old in text, "cannot find ghid_setup(gadget, 2)"
    text = text.replace(old, "return ghid_setup(cdev->gadget, 3);", 1)
    print("  android.c: ghid_setup 2 -> 3")

    # 3. bind the tablet as HID index 2, after keyboard (0) and mouse (1)
    old_bind = """	ret = hidg_bind_config(c, &ghid_device_android_mouse, 1);
	if (ret) {
		pr_info("%s: hid_function_bind_config mouse failed: %d\\n", __func__, ret);
		return ret;
	}
	return 0;"""
    assert old_bind in text, "cannot find the mouse bind block"
    new_bind = """	ret = hidg_bind_config(c, &ghid_device_android_mouse, 1);
	if (ret) {
		pr_info("%s: hid_function_bind_config mouse failed: %d\\n", __func__, ret);
		return ret;
	}
	printk(KERN_INFO "hid tablet\\n");
	ret = hidg_bind_config(c, &ghid_device_android_tablet, 2);
	if (ret) {
		pr_info("%s: hid_function_bind_config tablet failed: %d\\n", __func__, ret);
		return ret;
	}
	return 0;"""
    text = text.replace(old_bind, new_bind, 1)
    print("  android.c: bound tablet as HID device 2")

    assert text != original
    open(path, "w").write(text)
    return True


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    tree = sys.argv[1]
    gadget = os.path.join(tree, "drivers", "usb", "gadget")
    android_c = os.path.join(gadget, "android.c")
    if not os.path.isfile(android_c):
        raise SystemExit("not a kernel tree (no %s)" % android_c)

    dst = os.path.join(gadget, "f_hid_android_tablet.c")
    shutil.copyfile(SRC, dst)
    print("  copied f_hid_android_tablet.c into drivers/usb/gadget/")

    patch_android_c(android_c)

    # Sanity: the pieces this patch depends on must really be present.
    mk = open(os.path.join(gadget, "Makefile")).read()
    if "android.o f_hid.o" not in mk:
        print("  WARNING: Makefile does not build f_hid.o into g_android -")
        print("           this tree may need CONFIG_USB_G_HID after all")
    else:
        print("  verified: Makefile already links f_hid.o into g_android")

    print("\ndone. Rebuild the kernel, then on the device:")
    print("  echo 0 > /sys/class/android_usb/android0/enable")
    print("  echo hid > /sys/class/android_usb/android0/functions")
    print("  echo 1 > /sys/class/android_usb/android0/enable")
    print("  ls -l /dev/hidg*        # hidg0 keyboard, hidg1 mouse, hidg2 pen")


if __name__ == "__main__":
    main()
