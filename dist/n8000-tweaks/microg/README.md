# microG on LineageOS 16 (GT-N8000)

## Read this before installing — it may not be what you want

This ROM ships with **no Google apps and no Google Play Services at all**
(verified against the build's `/system/app` + `/system/priv-app`).

That matters: microG is a *lightweight replacement* for Play Services. It is a
big battery win **compared to full GApps** — but compared to *nothing*, it is a
net battery **cost**. It adds a background service, push sockets and location
plumbing that currently do not exist on this device.

So:

| Your situation | Recommendation |
|----------------|----------------|
| You want the lightest, longest-lasting tablet and use F-Droid / APKs | **Do not install microG.** You are already at the optimum. |
| Some app you need refuses to run without Play Services, or you want push notifications | Install microG — it is by far the lightest way to get that. |
| You want the real Play Store / paid apps | You need full GApps (pico), not microG — heavier. |

## The blocker: this ROM has no signature spoofing

microG only works if the OS lets it impersonate the Play Services signature.
Stock LineageOS deliberately does **not** ship that patch, and this build is no
exception — `framework-res.apk`'s manifest contains no
`android.permission.FAKE_PACKAGE_SIGNATURE` (checked directly in the ROM image).

Installing microG **without** fixing this gives you a permanently broken
"self-check failed" screen and apps still refusing to start.

You have two working routes:

### Route A — NanoDroid patcher (recommended, systemless)

`NanoDroid-patcher` rewrites `services.jar` at boot as a Magisk module, so the
ROM partition is untouched and removing the module fully reverts it.

1. Download from <https://downloads.nanolx.org/NanoDroid/Stable/> :
   - `NanoDroid-microG-<ver>.zip`  (microG + F-Droid + companions)
   - `NanoDroid-patcher-<ver>.zip` (signature-spoofing patcher)
2. Flash **both** in Magisk → Modules → Install from storage, patcher last.
3. Reboot. Expect the first boot after patching to be slow (services.jar is
   recompiled).
4. Open **microG Settings → Self-Check**: every box must be ticked, especially
   *"System supports signature spoofing"*.

### Route B — fetch microG yourself

`fetch-microg.sh` (next to this file) downloads the current official microG
APKs from the microG GitHub releases and verifies each SHA-256. It does **not**
solve signature spoofing — you still need Route A's patcher, or a ROM built
with the spoof patch.

## After it works — keep it light

```bash
# Only enable what you actually need. Each one costs battery.
# microG Settings -> Google device registration : ON  (needed for push)
#                 -> Cloud Messaging (GCM)      : ON  only if you need push
#                 -> Google SafetyNet           : OFF
#                 -> UnifiedNlp backends        : pick ONE, or none
```

Location without Google: install a single UnifiedNlp backend (e.g. *Déjà Vu*
offline, or *Mozilla Location Service*) — not several, they all run.

## Reverting

Remove the NanoDroid modules in Magisk and reboot. Nothing was written to
`/system`.
