#!/system/bin/sh
# Undo debloat.sh — reinstalls the removed system apps for the current user.
# The APKs were never deleted, so this just re-enables them.
#
# Run from a PC:   adb shell < restore-debloat.sh

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

echo ">>> Restoring debloated apps..."
for p in $PKGS; do
    cmd package install-existing "$p" >/dev/null 2>&1 && echo "  restored $p" || echo "  skip     $p"
done
echo ">>> Done. Reboot recommended."
