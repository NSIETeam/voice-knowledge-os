"""Generate a deterministic 256px RGBA icon using only the Python stdlib."""

from pathlib import Path
import struct
import zlib


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


size = 256
rows = []
for y in range(size):
    row = bytearray([0])
    for x in range(size):
        edge = min(x, y, size - 1 - x, size - 1 - y)
        if edge < 24:
            row.extend((31, 41, 55, 255))
        elif (x - 128) ** 2 + (y - 128) ** 2 < 42 ** 2:
            row.extend((31, 41, 55, 255) if abs(x - 128) > 6 and abs(y - 128) > 6 else (249, 250, 251, 255))
        else:
            row.extend((249, 250, 251, 255))
    rows.append(bytes(row))
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")
target = Path(__file__).parent.parent / "src-tauri" / "icons" / "icon.png"
target.write_bytes(png)
ico = target.with_suffix(".ico")
ico.write_bytes(
    struct.pack("<HHH", 0, 1, 1)
    + struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 0, len(png), 6 + 16)
    + png
)
print(target)
print(ico)
