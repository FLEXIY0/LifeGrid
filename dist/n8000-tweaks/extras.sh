#!/system/bin/sh
# Free, reversible performance wins that need no kernel work and no repacking.
#   adb shell < extras.sh
#
# Everything here is either a Settings value (revert by setting it back) or an
# ART recompile (revert with `cmd package compile --reset -a`).

echo ">>> 1/4  Ahead-of-time compile every app to 'speed'"
# Android 9 compiles apps lazily from usage profiles. Forcing full AOT trades
# storage for launch speed and removes JIT CPU work at runtime = less battery
# spent re-compiling the same code. Takes several minutes on this hardware.
cmd package compile -m speed -a 2>/dev/null || echo "    (skipped)"

echo ">>> 2/4  Cut animation time (real perceived-speed win on Mali-400)"
settings put global window_animation_scale      0.5
settings put global transition_animation_scale  0.5
settings put global animator_duration_scale     0.5

echo ">>> 3/4  Wi-Fi power saving + no scan throttling churn"
settings put global wifi_scan_always_enabled 0
settings put global ble_scan_always_enabled  0
# keep the radio asleep between beacons where the driver honours it
settings put global wifi_sleep_policy 0 2>/dev/null

echo ">>> 4/4  Trim filesystems (/data and /cache are f2fs on this ROM)"
for M in /data /cache; do fstrim "$M" >/dev/null 2>&1 && echo "    trimmed $M"; done

echo
echo ">>> Done. Reboot recommended."
echo ">>> Revert AOT with:  cmd package compile --reset -a"
echo ">>> Revert animations by setting the three scales back to 1.0"
echo
echo ">>> Set by hand (no reliable settings key on Android 9):"
echo "    Settings -> Developer options -> Background process limit -> 'At most 2 processes'"
