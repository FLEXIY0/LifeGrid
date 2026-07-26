# The pen: what it can do, and how to get the most out of it

Everything below comes from the Wacom G5SP driver in this device's kernel
(`drivers/input/touchscreen/wacom/wacom_i2c.c`), not from forum lore.

## What the hardware actually reports

```
ABS_X  ABS_Y  ABS_PRESSURE          BTN_TOUCH
BTN_STYLUS  BTN_STYLUS2             (two barrel buttons)
BTN_TOOL_PEN  BTN_TOOL_RUBBER       (tip and eraser end)
```

- **1024 pressure levels** (`WACOM_MAX_PRESSURE = 1023`)
- **A real eraser**: flip the pen and `BTN_TOOL_RUBBER` fires. Apps that support
  it switch to erase automatically — the original Apple Pencil cannot do this.
- **Two barrel buttons**, usually mapped to right-click and erase.
- **Palm rejection is structural, not software.** The EMR digitizer is a
  separate sensing layer from the capacitive touchscreen, so it physically
  cannot see your hand. This is the one area where the hardware is not behind a
  modern tablet.

## Honest comparison with an iPad

| | iPad Pro + Pencil | GT-N8000 |
|---|---|---|
| Pressure | fine-grained | **1024 levels — comparable** |
| Eraser | Pencil 2: double-tap | **physical eraser end** |
| Palm rejection | software | **separate sensing layer** |
| Pen sampling | 240 Hz | **133 Hz** (driver maximum) |
| Display | 120 Hz | **60 Hz** — hardware |
| Latency | ~9 ms, with stroke prediction | higher, **no prediction at all** |
| Tilt | yes | **none** — `ABS_TILT` is absent from the driver |

Pressure, eraser and palm rejection hold up. Tilt and latency do not, and no
amount of configuration changes that: the sampling ceiling is in the driver, the
refresh rate is in the panel, and Android 9 has no touch prediction.

## What this kit does about it

| Change | Where | Effect |
|---|---|---|
| `deviceType = pointer` → **`stylus`** | ROM patch (`sec_e-pen.idc`) | The stock ROM declared the digitizer as a *mouse*. Apps checking `TOOL_TYPE_STYLUS` now see a stylus, and the mouse cursor stops trailing the pen. |
| `pressure.calibration = physical`, `scale = 0.000978` | ROM patch | There was no pressure calibration at all. 1/1023 maps full physical pressure to 1.0. |
| `epen_sampling_rate` → **133 Hz** | `magisk-n8000-pen` | Driver maximum; the ROM leaves the firmware default. |
| `epen_saving_mode` → 1 | `magisk-n8000-pen` | Digitizer powers down while the pen is in its silo. |
| `debug.sf.latch_unsignaled=1` | `magisk-n8000-props` | Shaves about a frame off event-to-pixel latency. |
| Animation scales 0.5x | `extras.sh` | Less compositing work between strokes. |

Set animations to **0** instead of 0.5 if you want the crispest possible feel:
`Settings → Developer options → Window/Transition/Animator scale → off`.

## Where the remaining "feel" comes from — the app

With the OS side tuned, the largest remaining factor is the drawing app's own
smoothing and stroke interpolation. A note app that interpolates between input
samples will feel dramatically better than one that draws raw points, on
identical hardware. Try a few before concluding the tablet is the limit.

Not tunable from here: there is no prediction layer in Android 9 to enable.

## Using it as a graphics tablet for a PC

Ordered by how well they fit this device:

1. **VirtualTablet** — explicitly supports Wacom-digitizer Galaxy Note devices
   with pressure. Needs a small free server on the PC. Closest to a plug-in
   Wacom experience today.
2. **Weylus** — **no app to install**: it serves a page you open in the tablet's
   browser (Fennec is bundled). Pressure and multi-touch work only when the host
   runs Linux; other hosts still get low-latency absolute pen tracking.
3. **GfxTablet** — unmaintained upstream, several forks; UDP to port 40118.

None of these were tested on this device here — verify pressure actually reaches
your drawing app before committing to one.

### The interesting option that needs a kernel rebuild

This kernel already carries the USB HID gadget code —
`drivers/usb/gadget/f_hid.c` exists, and `android.c` already includes
`f_hid_android_keyboard.c` and `f_hid_android_mouse.c` and calls
`ghid_setup(cdev->gadget, 2)`. Only `CONFIG_USB_G_HID` is switched off in the
defconfig.

Turning it on and adding a third descriptor — a HID **digitizer** with absolute
coordinates and pressure — would make the tablet appear to any PC as a
**class-compliant graphics tablet**: no server app, no drivers, works on
Windows, macOS and Linux, in any application. That is a genuinely better
outcome than any of the three apps above, and it is the one thing that would
justify rebuilding this kernel. See the notes in `FINDINGS.md` on kernel builds
before deciding — it cannot be boot-tested anywhere but on your device.
