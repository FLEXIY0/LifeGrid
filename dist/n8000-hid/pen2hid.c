/*
 * pen2hid - bridge the GT-N8000's Wacom digitizer to the USB HID gadget.
 *
 * Reads pen events from the kernel input device and writes 7-byte HID reports
 * to /dev/hidg2, so the tablet appears to any host as a class-compliant pen
 * digitizer. No driver or helper application on the host side.
 *
 *   pen2hid [-i /dev/input/eventN] [-o /dev/hidg2] [-v]
 *
 * With no -i it finds the device named "sec_e-pen" by itself.
 *
 * Report layout must match f_hid_android_tablet.c:
 *   byte 0   bit0 tip, bit1 barrel, bit2 eraser, bit3 in-range, bits4-7 pad
 *   byte 1-2 X        0..32767, little endian
 *   byte 3-4 Y        0..32767, little endian
 *   byte 5-6 pressure 0..1023,  little endian
 *
 * Build (static, so it needs nothing on the device):
 *   arm-linux-gnueabi-gcc -O2 -static -o pen2hid pen2hid.c
 */

#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/ioctl.h>

#define HID_MAX 32767
#define PRESSURE_MAX 1023

static int verbose;

/* Locate the digitizer by name so we don't depend on event node numbering,
 * which changes between boots and between ROM versions. */
static int find_pen(char *out, size_t outlen)
{
	char path[64], name[128];
	int i, fd;

	for (i = 0; i < 32; i++) {
		snprintf(path, sizeof(path), "/dev/input/event%d", i);
		fd = open(path, O_RDONLY);
		if (fd < 0)
			continue;
		memset(name, 0, sizeof(name));
		if (ioctl(fd, EVIOCGNAME(sizeof(name) - 1), name) >= 0) {
			if (strstr(name, "e-pen") || strstr(name, "epen") ||
			    strstr(name, "Wacom") || strstr(name, "wacom")) {
				close(fd);
				snprintf(out, outlen, "%s", path);
				fprintf(stderr, "pen2hid: found \"%s\" at %s\n",
					name, path);
				return 0;
			}
		}
		close(fd);
	}
	return -1;
}

/* Map a raw axis value onto 0..HID_MAX. Falls back to passing the value
 * through when the driver reports a degenerate range. */
static int scale(int value, int min, int max)
{
	long span = (long)max - (long)min;

	if (span <= 0)
		return value < 0 ? 0 : (value > HID_MAX ? HID_MAX : value);
	if (value < min)
		value = min;
	if (value > max)
		value = max;
	return (int)(((long)(value - min) * HID_MAX) / span);
}

int main(int argc, char **argv)
{
	const char *in_path = NULL, *out_path = "/dev/hidg2";
	char found[64];
	struct input_absinfo abs_x, abs_y, abs_p;
	struct input_event ev;
	unsigned char report[7], last[7];
	int fd_in, fd_out, opt;
	int x = 0, y = 0, pressure = 0;
	int tip = 0, barrel = 0, eraser = 0, in_range = 0;

	while ((opt = getopt(argc, argv, "i:o:vh")) != -1) {
		switch (opt) {
		case 'i': in_path = optarg; break;
		case 'o': out_path = optarg; break;
		case 'v': verbose = 1; break;
		default:
			fprintf(stderr,
				"usage: %s [-i /dev/input/eventN] [-o /dev/hidg2] [-v]\n",
				argv[0]);
			return 1;
		}
	}

	if (!in_path) {
		if (find_pen(found, sizeof(found)) < 0) {
			fprintf(stderr, "pen2hid: no digitizer found. Pass -i explicitly.\n");
			return 1;
		}
		in_path = found;
	}

	fd_in = open(in_path, O_RDONLY);
	if (fd_in < 0) {
		fprintf(stderr, "pen2hid: open %s: %s\n", in_path, strerror(errno));
		return 1;
	}

	memset(&abs_x, 0, sizeof(abs_x));
	memset(&abs_y, 0, sizeof(abs_y));
	memset(&abs_p, 0, sizeof(abs_p));
	ioctl(fd_in, EVIOCGABS(ABS_X), &abs_x);
	ioctl(fd_in, EVIOCGABS(ABS_Y), &abs_y);
	ioctl(fd_in, EVIOCGABS(ABS_PRESSURE), &abs_p);
	fprintf(stderr, "pen2hid: X %d..%d  Y %d..%d  pressure %d..%d\n",
		abs_x.minimum, abs_x.maximum, abs_y.minimum, abs_y.maximum,
		abs_p.minimum, abs_p.maximum);

	fd_out = open(out_path, O_WRONLY);
	if (fd_out < 0) {
		fprintf(stderr, "pen2hid: open %s: %s\n", out_path, strerror(errno));
		fprintf(stderr, "         is the gadget enabled? see README\n");
		close(fd_in);
		return 1;
	}

	memset(last, 0, sizeof(last));

	while (read(fd_in, &ev, sizeof(ev)) == sizeof(ev)) {
		if (ev.type == EV_ABS) {
			switch (ev.code) {
			case ABS_X: x = ev.value; break;
			case ABS_Y: y = ev.value; break;
			case ABS_PRESSURE: pressure = ev.value; break;
			}
		} else if (ev.type == EV_KEY) {
			switch (ev.code) {
			case BTN_TOUCH: tip = !!ev.value; break;
			case BTN_STYLUS: barrel = !!ev.value; break;
			case BTN_TOOL_RUBBER: eraser = !!ev.value;
					      in_range = !!ev.value; break;
			case BTN_TOOL_PEN: in_range = !!ev.value; break;
			}
		} else if (ev.type == EV_SYN && ev.code == SYN_REPORT) {
			int sx = scale(x, abs_x.minimum, abs_x.maximum);
			int sy = scale(y, abs_y.minimum, abs_y.maximum);
			int sp = pressure;

			if (abs_p.maximum > 0 && abs_p.maximum != PRESSURE_MAX)
				sp = (int)(((long)pressure * PRESSURE_MAX) / abs_p.maximum);
			if (sp < 0) sp = 0;
			if (sp > PRESSURE_MAX) sp = PRESSURE_MAX;

			report[0] = (unsigned char)((tip ? 1 : 0) |
						    (barrel ? 2 : 0) |
						    (eraser ? 4 : 0) |
						    (in_range ? 8 : 0));
			report[1] = sx & 0xFF;
			report[2] = (sx >> 8) & 0xFF;
			report[3] = sy & 0xFF;
			report[4] = (sy >> 8) & 0xFF;
			report[5] = sp & 0xFF;
			report[6] = (sp >> 8) & 0xFF;

			/* Don't spam the host with identical reports - the
			 * digitizer keeps emitting SYN while simply hovering. */
			if (memcmp(report, last, sizeof(report)) == 0)
				continue;
			memcpy(last, report, sizeof(report));

			if (write(fd_out, report, sizeof(report)) < 0) {
				if (errno == ESHUTDOWN || errno == ENODEV) {
					fprintf(stderr, "pen2hid: host disconnected\n");
					break;
				}
				if (verbose)
					fprintf(stderr, "pen2hid: write: %s\n",
						strerror(errno));
			} else if (verbose) {
				fprintf(stderr, "x=%5d y=%5d p=%4d %s%s%s%s\n",
					sx, sy, sp,
					tip ? "tip " : "", barrel ? "btn " : "",
					eraser ? "eraser " : "",
					in_range ? "range" : "");
			}
		}
	}

	close(fd_in);
	close(fd_out);
	return 0;
}
