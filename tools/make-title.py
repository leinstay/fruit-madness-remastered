#!/usr/bin/env python3
"""Builds assets/sprites/titleBg.svg, the animated title screen.

    python tools/make-title.py <path-to-the-fla> [--freeze <layer-name-part>]

The input is the original 2013 Flash source document (.fla). It is the artists'
working file and is not part of this repository, so its path is given on the
command line; tools/xfl2svg.py does the drawing conversion.

The title is the `Images/Menu` symbol: 162 drawing layers on a 31-keyframe
timeline. Written out frame by frame it would be about 29 MB, because most of the
cast stands still while a few layers move and every frame would repeat the lot.
This tool stores every distinct drawing once instead: one shared `<defs>` of
`<g id="sN">` groups, then 31 frame groups that are nothing but `<use>` elements.

The result is a single SVG that

  * opens correctly as a plain image — frame 0 is visible, the other 30 carry
    `display="none"`;
  * the game can take apart without an XML parser: every frame group is preceded
    by an exact marker comment, so cutting frame k out is a string slice between
    `<!--frame:k-->` and the next marker, and `<!--frames:end-->` closes the last;
  * shows the visible field only: `width`/`height` 600x450 and a viewBox centred
    on the symbol's registration point, which is where the game draws it.

The artwork was drawn over a white page and several shapes rely on it — among them
the whipped-cream mound and the ice-cream character's eye glints, which are holes
in the eye rather than painted highlights — so a white backdrop rect is the first
drawable child.

The two labels baked into the original (the version line and the credit) are not
part of the output: the game draws both at runtime in its own pixel font.

The one raster in the whole artwork is the rainbow "madness" banner, 135x60 px. It
lives in the repository as assets/sprites/titleBanner.png and is embedded as a data
URI, rendered with `image-rendering: pixelated` as it always was.

Options
-------
  --freeze PART   hold every layer whose name contains PART on its first keyframe.
                  Repeatable, matched case-insensitively. The heaviest animation in
                  the title by far is the fizz inside the cola bottle; freezing it
                  roughly halves the file at the cost of that one movement. Off by
                  default: the title keeps every animation it had in 2013.
  --out FILE      write somewhere other than assets/sprites/titleBg.svg.

Deterministic and idempotent: the same document always produces a byte-identical
file, and nothing else is written.
"""

import argparse
import gzip
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xfl2svg as xfl  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_FILE = os.path.join(ROOT, "assets", "sprites", "titleBg.svg")
BANNER_FILE = os.path.join(ROOT, "assets", "sprites", "titleBanner.png")

# The library item the title screen is drawn in, and the name of the one embedded
# image inside it.
ITEM = "Images/Menu"
BANNER_ITEM = "Images/!Madness"

# The logical field, and the symbol's registration point inside the document's own
# coordinate frame. The game puts that point at the centre of the field, so the
# viewBox is the 600x450 box centred on ORIGIN. Any origin would do; this one keeps
# every coordinate of the viewport positive.
FIELD_W = 600
FIELD_H = 450
ORIGIN = (500, 335)

EXPECTED_FRAMES = 31


def build(fla, freeze=()):
    """-> (svg text, stats dict)."""
    data = xfl.open_document(fla)
    timeline = xfl.load_symbol(data, ITEM, fla)
    bitmaps = {BANNER_ITEM: banner()}
    converter = xfl.Converter(bitmaps)

    layers = [(index, layer) for index, layer in enumerate(xfl.layer_list(timeline))
              if xfl.is_drawable_layer(layer)]
    ticks = xfl.keyframe_ticks(timeline)

    # Every layer drawn at every keyframe it owns, folded into a set of unique
    # drawings. Two layers that happen to draw exactly the same markup share one
    # definition, which is most of why the file is a tenth of the frame-by-frame
    # size.
    drawings = {}                       # layer index -> {tick: markup}
    for index, layer in layers:
        held = frozen(layer, freeze)
        per_tick = {}
        for tick, _duration in xfl.keyframes_of(layer):
            frame = xfl.frame_for(layer, held if held is not None else tick)
            markup = ""
            if frame is not None:
                elements = frame.find(xfl.NS + "elements")
                if elements is not None and len(elements):
                    fragments = []
                    converter.elements(elements, xfl.IDENTITY, xfl.Box(), fragments)
                    markup = "".join(fragments)
            per_tick[tick] = markup
        drawings[index] = per_tick

    order = [index for index, _layer in reversed(layers)]   # bottom layer first
    keys = {index: xfl.keyframes_of(layer) for index, layer in layers}

    # The definitions are laid out layer by layer, keyframe by keyframe. Keeping the
    # successive drawings of one layer next to each other matters: they differ in a
    # handful of coordinates, and gzip only sees that when they are close together.
    # Ordering them by frame instead costs about 250 KB on the wire.
    definitions = {}                    # markup -> id
    ordered = []                        # the definitions in the order they appear
    for index, _layer in layers:
        for tick, _duration in keys[index]:
            markup = drawings[index][tick]
            if markup and markup not in definitions:
                definitions[markup] = "s%d" % len(ordered)
                ordered.append((definitions[markup], markup))

    frames = []
    for number, tick in enumerate(ticks):
        uses = []
        for index in order:
            markup = drawings[index].get(showing(keys[index], tick), "")
            if not markup:
                continue
            uses.append('<use xlink:href="#%s"/>' % definitions[markup])
        frames.append('<!--frame:%d--><g id="frame-%d"%s transform="matrix(1,0,0,1,%d,%d)">%s</g>'
                      % (number, number, "" if number == 0 else ' display="none"',
                         ORIGIN[0], ORIGIN[1], "".join(uses)))

    body = "".join('<g id="%s">%s</g>' % (name, markup) for name, markup in ordered)
    view_x = ORIGIN[0] - FIELD_W // 2
    view_y = ORIGIN[1] - FIELD_H // 2
    text = ('<svg xmlns="http://www.w3.org/2000/svg" '
            'xmlns:xlink="http://www.w3.org/1999/xlink" '
            'width="%d" height="%d" viewBox="%d %d %d %d">'
            '<defs>%s</defs>'
            '<!--white backdrop intended by the artwork-->'
            '<rect x="%d" y="%d" width="%d" height="%d" fill="#ffffff"/>'
            '%s<!--frames:end--></svg>'
            % (FIELD_W, FIELD_H, view_x, view_y, FIELD_W, FIELD_H, body,
               view_x, view_y, FIELD_W, FIELD_H, "".join(frames)))

    stats = {
        "layers": len(layers),
        "frames": len(ticks),
        "definitions": len(ordered),
        "defs_bytes": len(body.encode("utf-8")),
        "notes": sorted(converter.notes),
    }
    return text, stats


def banner():
    """The embedded rainbow banner as `(data uri, width, height)`."""
    if not os.path.isfile(BANNER_FILE):
        raise SystemExit("missing %s, the one raster of the title artwork"
                         % BANNER_FILE)
    width, height = xfl.png_size(BANNER_FILE)
    return (xfl.data_uri(BANNER_FILE), float(width), float(height))


def frozen(layer, freeze):
    """The tick a frozen layer is held on, or None when it animates normally."""
    name = (layer.get("name") or "").lower()
    if not any(part in name for part in freeze):
        return None
    keys = xfl.keyframes_of(layer)
    return keys[0][0] if keys else None


def showing(keys, tick):
    """Which of a layer's keyframes is on screen at `tick`."""
    best = None
    for index, duration in keys:
        if index <= tick < index + duration:
            return index
        if index <= tick:
            best = index
    return best


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Builds assets/sprites/titleBg.svg from the original 2013 "
                    "Flash source document.")
    parser.add_argument("fla", help="path to the .fla (not part of this repository)")
    parser.add_argument("--freeze", action="append", default=[], metavar="PART",
                        help="hold every layer whose name contains PART on its "
                             "first keyframe")
    parser.add_argument("--out", default=OUT_FILE)
    args = parser.parse_args(argv)

    text, stats = build(args.fla, tuple(part.lower() for part in args.freeze))
    if stats["frames"] != EXPECTED_FRAMES:
        raise SystemExit("the title has %d keyframes, expected %d"
                         % (stats["frames"], EXPECTED_FRAMES))
    raw = text.encode("utf-8")
    with open(args.out, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)

    print("%s: %d frames of %d layers, %d unique drawings"
          % (args.out, stats["frames"], stats["layers"], stats["definitions"]))
    print("bytes: %d raw, %d gzipped (definitions %d)"
          % (len(raw), len(gzip.compress(raw, 9)), stats["defs_bytes"]))
    for note in stats["notes"]:
        print("note: %s" % note, file=sys.stderr)


if __name__ == "__main__":
    main()
