"""Reader for the archive an uncompiled Flash document (.fla) is.

A .fla is a zip container holding an XFL document tree (`DOMDocument.xml`,
`LIBRARY/*.xml`, `bin/*.dat`). Flash wrote those archives with a central
directory that Python's `zipfile` rejects, so this module walks the local file
headers instead, which is all the data really needs.

Supported compression: method 0 (stored) and method 8 (raw deflate). Standard
library only.
"""

import struct
import zlib

SIGNATURE = b"PK\x03\x04"
HEADER_SIZE = 30


def entries(path):
    """Yield `(name, data)` for every local file header in the archive.

    `data` is None for an entry compressed with a method this reader does not
    know; the caller decides whether that matters.
    """
    with open(path, "rb") as fh:
        buf = fh.read()
    pos = 0
    end = len(buf)
    while True:
        start = buf.find(SIGNATURE, pos)
        if start < 0:
            return
        try:
            (_ver, flags, method, _mtime, _mdate, _crc, csize, usize, nlen,
             elen) = struct.unpack_from("<HHHHHIIIHH", buf, start + 4)
        except struct.error:
            return
        name_at = start + HEADER_SIZE
        name = buf[name_at:name_at + nlen].decode("utf-8", "replace")
        name = name.replace("\\", "/")
        body = name_at + nlen + elen
        if csize == 0 and usize == 0 and (flags & 0x08):
            # A streamed entry states its sizes only in the trailing data
            # descriptor, so take everything up to the next header.
            nxt = buf.find(SIGNATURE, body)
            raw = buf[body:nxt if nxt > 0 else end]
        else:
            raw = buf[body:body + csize]
        if method == 8:
            try:
                data = zlib.decompress(raw, -15)
            except zlib.error:
                # A streamed entry carries trailing bytes that are not part of
                # the stream; decompress as far as the stream goes.
                data = zlib.decompressobj(-15).decompress(raw)
        elif method == 0:
            data = raw[:usize] if usize else raw
        else:
            data = None
        yield name, data
        pos = body + (csize if csize else max(len(raw), 1))


def read_map(path):
    """The whole archive as `{name: bytes}`; the first entry of a name wins."""
    out = {}
    for name, data in entries(path):
        if data is not None and name not in out:
            out[name] = data
    return out


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 2:
        raise SystemExit("usage: python tools/xfl_zip.py <document.fla>")
    for entry_name, entry_data in entries(sys.argv[1]):
        size = len(entry_data) if entry_data is not None else -1
        print("%9d  %s" % (size, entry_name))
