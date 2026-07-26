# Turn the GT-N8000 into a real USB graphics tablet

Makes the tablet present itself to any computer as a **class-compliant HID pen
digitizer**. No server application, no drivers, no network — plug in the USB
cable and it is a graphics tablet in Windows, macOS and Linux, in any program.

This uses the one piece of hardware on this device that has not aged: the
**Wacom G5SP EMR digitizer**, 1024 pressure levels, with a physical eraser end
and a sensing layer separate from the touchscreen (so palm rejection is
structural, not software).

## The surprising part: most of it is already in your kernel

The HID gadget is **not** something this project adds. It is already compiled
into the running kernel:

```
drivers/usb/gadget/Makefile   g_android-y := android.o f_hid.o
defconfig                     CONFIG_USB_G_ANDROID=y
drivers/usb/gadget/android.c  #include "f_hid_android_keyboard.c"
                              #include "f_hid_android_mouse.c"
                              &hid_function in supported_functions[]  ← no #ifdef
```

`CONFIG_USB_G_HID`, which is unset, gates the *standalone* `g_hid.o` gadget —
a different thing that has nothing to do with the Android composite gadget.

**So keyboard and mouse gadgets work on a stock build right now**, with no
rebuild at all:

```bash
adb root
adb shell 'echo 0 > /sys/class/android_usb/android0/enable'
adb shell 'echo hid > /sys/class/android_usb/android0/functions'
adb shell 'echo 1 > /sys/class/android_usb/android0/enable'
adb shell ls -l /dev/hidg*      # expect hidg0 (keyboard), hidg1 (mouse)
```

If those two nodes appear, everything below is going to work.

## What actually needs adding

The existing descriptors are a keyboard and a **relative** mouse. A mouse can
say "moved 3 left"; it can never say "the pen is at this exact spot, pressing
this hard". A graphics tablet needs an **absolute** device with pressure, so
this adds a third HID descriptor and binds it as `/dev/hidg2`.

| File | What it is |
|------|-----------|
| `kernel-patch/f_hid_android_tablet.c` | The HID Digitizers/Pen report descriptor |
| `kernel-patch/apply.py` | Applies it: copies the file, adds the include, `ghid_setup(gadget, 2)` → `3`, binds the tablet as HID index 2. Idempotent, asserts on every edit |
| `pen2hid.c` | Userspace bridge: reads the digitizer, writes HID reports |
| `tools/check_descriptor.py` | Parses the descriptor and checks it is well-formed |

## Build

**Kernel** — needs a GCC 4.x-era ARM toolchain, because this is Linux 3.0:

```bash
python3 kernel-patch/apply.py /path/to/android_kernel_samsung_smdk4412
# then build lineageos_n8000_defconfig and repack boot.img with
# ../n8000-rom/tools/bootimg.py
```

**Bridge** — an ordinary static binary, so a current cross-compiler is fine:

```bash
arm-linux-gnueabi-gcc -O2 -static -o pen2hid pen2hid.c
adb push pen2hid /data/local/tmp/ && adb shell chmod 755 /data/local/tmp/pen2hid
```

## Run

```bash
adb shell 'echo 0 > /sys/class/android_usb/android0/enable'
adb shell 'echo hid > /sys/class/android_usb/android0/functions'
adb shell 'echo 1 > /sys/class/android_usb/android0/enable'
adb shell /data/local/tmp/pen2hid -v
```

`pen2hid` finds the digitizer by name, so event node numbering does not matter.
`-v` prints every report, which is the quickest way to see whether the pen is
being read at all.

## Report format

7 bytes, and `f_hid_android_tablet.c` and `pen2hid.c` must agree on it:

| Bytes | Meaning |
|-------|---------|
| 0 | bit0 tip, bit1 barrel button, bit2 eraser, bit3 in-range, bits 4-7 padding |
| 1-2 | X, little endian, 0..32767 |
| 3-4 | Y, little endian, 0..32767 |
| 5-6 | Pressure, little endian, 0..1023 |

X and Y are rescaled into a normalised range so the host needs to know nothing
about this particular panel. Pressure keeps the digitizer's native 0..1023, so
no precision is lost on the way out.

## What was verified here, and what was not

**Verified mechanically:**

- The descriptor parses: 67 bytes as declared, collections balanced, input
  fields total exactly the declared 7-byte report (`tools/check_descriptor.py`).
- `apply.py` applies cleanly to a real kernel tree, is idempotent, and produces
  exactly three changes to `android.c` — nothing else moves.
- The bridge compiles clean with `-Wall` for ARM, statically, 477 KB.
- Its logic was tested by compiling natively and feeding it a synthetic event
  stream. Encoded reports matched the expected bytes exactly:

```
09 e803 d007 0002  ->  x=1000 y=2000 p=512   [tip, range]
0f e803 d007 ff03  ->  x=1000 y=2000 p=1023  [tip, barrel, eraser, range]
```

**Not verified — there is no hardware here:**

- that the patched kernel boots;
- that a host enumerates the digitizer and shows pressure in a drawing app;
- how much latency the USB path adds.

The first real test is yours. Back up `boot` in TWRP before flashing a patched
kernel — Download Mode and Odin remain the fallback either way.
