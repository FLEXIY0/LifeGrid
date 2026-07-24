# microG on LineageOS 16 (GT-N8000)

## Good news: this ROM already supports signature spoofing

An earlier version of this file said you needed the NanoDroid patcher. **That
was wrong.** Disassembling the ROM's `services.jar` shows the microG signature
spoofing patch is already compiled in:

```
smali/com/android/server/pm/PackageManagerService.smali

  .method private mayFakeSignature(PackageParser$Package, PackageInfo, Set)PackageInfo
      const-string v0, "android.permission.FAKE_PACKAGE_SIGNATURE"
      ...  targetSdkVersion > 22
      const-string p3, "fake-signature"        <- read from app meta-data
      new-instance v1, Landroid/content/pm/Signature;
```

and it is actually reached — there is a live call site at
`PackageManagerService.smali:25603`, on the `generatePackageInfo` path.

The matching permission is declared in `framework-res.apk`:

```
$ strings -el fwres/AndroidManifest.xml | grep FAKE_PACKAGE
)android.permission.FAKE_PACKAGE_SIGNATURE
```

*Why the first check missed it:* `strings` was run over the **compressed** APK,
and then over the manifest in UTF-8 only. Android's binary XML keeps its string
pool in **UTF-16LE**, so the permission is invisible unless you use
`strings -el`. Both halves of the patch are present.

**So: no NanoDroid, no services.jar patching, no boot-time framework rewriting.
Install microG and it works.**

## Read this before installing anyway

This ROM ships with **no Google apps and no Play Services at all** (verified
against `/system/app` and `/system/priv-app`).

microG is a lightweight *replacement* for Play Services. Versus full GApps it is
a large battery win — but versus *nothing*, which is what you have, it is a net
battery **cost**: it adds a background service, push sockets and location
plumbing that currently do not exist.

| Your situation | Recommendation |
|----------------|----------------|
| You want the lightest, longest-running tablet and use F-Droid / plain APKs | **Skip microG.** You are already at the optimum. |
| An app you need refuses to start without Play Services, or you want push notifications | Install microG — by far the lightest way to get that. |
| You want the real Play Store and paid apps | You need GApps (pico), not microG — heavier. |

## Install

```bash
./fetch-microg.sh --install     # downloads official APKs, prints SHA-256, adb installs
```

Or by hand: install **GmsCore** (`com.google.android.gms`) and, for legacy
push, **GsfProxy**. Then reboot.

## Verify

Open **microG Settings → Self-Check**. The line that matters is:

> ☑ System supports signature spoofing

If it is unticked, grant the permission explicitly:
**Settings → Apps → microG Services Core → Permissions → allow
"Spoof package signature"**, then reboot and re-check.

## Keep it light

Each of these costs battery — enable only what you actually need:

```
microG Settings
  Google device registration ....... ON only if you need push
  Cloud Messaging (GCM) ............ ON only if you need push
  Google SafetyNet ................. OFF
  UnifiedNlp backends .............. pick exactly ONE, or none
```

For location without Google, install a single backend (e.g. *Déjà Vu* offline,
or *Mozilla Location Service*). Installing several means all of them run.

## Reverting

Uninstall the microG APKs. Nothing was written to `/system`, and no framework
file was modified — the spoofing support was already part of the ROM.
