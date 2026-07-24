#!/system/bin/sh
# Reversible debloat for LineageOS 16 on GT-N8000.
# `pm uninstall --user 0` only removes the app FOR THE CURRENT USER — the APK
# stays in /system, so a factory reset OR the restore block below brings it back.
# NO app is deleted from the ROM. Zero brick risk.
#
# Run from a PC:   adb shell < debloat.sh
# Or on-device in a root shell:   sh debloat.sh
#
# IMPORTANT: verify each package name on YOUR build first:
#   adb shell pm list packages | grep -Ei 'email|jelly|eleven|dream|egg|traceur'
# Comment out anything you actually use before running.

set -e 2>/dev/null

PKGS="
com.android.email
com.android.exchange
org.lineageos.jelly
org.lineageos.eleven
com.android.dreams.phototable
com.android.dreams.basic
com.android.egg
com.android.traceur
com.android.wallpaper.livepicker
"

echo ">>> Debloating (reversible, per-user)..."
for p in $PKGS; do
    if pm list packages | grep -q "package:$p$"; then
        pm uninstall --user 0 "$p" >/dev/null 2>&1 && echo "  removed  $p" || echo "  skip     $p (failed)"
    else
        echo "  absent   $p"
    fi
done
echo ">>> Done. Reboot recommended."
