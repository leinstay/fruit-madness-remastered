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
    `<!--frame:k-->` and the next marker, and `<!--frames:end-->` closes the last.
    Every definition sits on a line of its own inside `<defs>`, so the game can
    index them by id the same way and hand a frame only the drawings it uses;
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

One layer of the artwork is held still: the fizz inside the cola bottle (see
FROZEN_LAYERS). It is a 95x126 px detail that redraws nine times over the loop and
costs more than half of everything that moves, so it is stored once instead. Run
with --no-freeze to build the fully animated file.

Options
-------
  --freeze-index N  hold the layer at index N of the symbol's layer list on its
                  first keyframe. Repeatable. Overrides FROZEN_LAYERS.
  --freeze PART   the same by name: hold every layer whose name contains PART.
                  Repeatable, matched case-insensitively. Overrides FROZEN_LAYERS.
  --no-freeze     hold nothing; the title keeps every animation it had in 2013.
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

# Layers of `ITEM` that are held on their first keyframe, by index in the symbol's
# layer list. The one entry is the fill of the cola bottle, i.e. the bubbles rising
# in it: a 95x126 px detail with nine drawings of its own, which is 61 % of
# everything that moves over the loop. Frozen on purpose — the menu is calmer for
# it and the file drops from 982 KB to 408 KB on the wire. Recorded here rather
# than passed on the command line so that a plain run reproduces the file that is
# committed. Indices are stable: they are the order the layers are stored in.
FROZEN_LAYERS = (164,)


def build(fla, freeze=(), freeze_indices=FROZEN_LAYERS):
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
    held_layers = []
    for index, layer in layers:
        held = frozen(index, layer, freeze, freeze_indices)
        if held is not None:
            held_layers.append((index, len(xfl.keyframes_of(layer))))
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

    # One definition per line, and one frame per line. A frame uses about half of the
    # definitions, so the game builds a document out of just those before it rasterises a
    # frame; the line layout lets it index them by id with plain string operations and no
    # XML parser. Newlines are the only whitespace in the file.
    body = "".join('<g id="%s">%s</g>\n' % (name, markup) for name, markup in ordered)
    view_x = ORIGIN[0] - FIELD_W // 2
    view_y = ORIGIN[1] - FIELD_H // 2
    text = ('<svg xmlns="http://www.w3.org/2000/svg" '
            'xmlns:xlink="http://www.w3.org/1999/xlink" '
            'width="%d" height="%d" viewBox="%d %d %d %d">\n'
            '<defs>\n%s</defs>\n'
            '<!--white backdrop intended by the artwork-->\n'
            '<rect x="%d" y="%d" width="%d" height="%d" fill="#ffffff"/>\n'
            '%s<!--frames:end-->\n</svg>\n'
            % (FIELD_W, FIELD_H, view_x, view_y, FIELD_W, FIELD_H, body,
               view_x, view_y, FIELD_W, FIELD_H,
               "".join(frame + "\n" for frame in frames)))

    stats = {
        "layers": len(layers),
        "frames": len(ticks),
        "definitions": len(ordered),
        "defs_bytes": len(body.encode("utf-8")),
        "held": held_layers,
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


def frozen(index, layer, freeze, freeze_indices):
    """The tick a frozen layer is held on, or None when it animates normally."""
    name = (layer.get("name") or "").lower()
    if index not in freeze_indices and not any(part in name for part in freeze):
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
    parser.add_argument("--freeze-index", action="append", default=[], type=int,
                        metavar="N", help="hold the layer at index N on its first "
                                          "keyframe")
    parser.add_argument("--no-freeze", action="store_true",
                        help="hold nothing; keep every animation")
    parser.add_argument("--out", default=OUT_FILE)
    args = parser.parse_args(argv)

    chosen = args.freeze or args.freeze_index
    indices = () if args.no_freeze else (tuple(args.freeze_index) if chosen
                                         else FROZEN_LAYERS)
    names = () if args.no_freeze else tuple(part.lower() for part in args.freeze)
    text, stats = build(args.fla, names, indices)
    if stats["frames"] != EXPECTED_FRAMES:
        raise SystemExit("the title has %d keyframes, expected %d"
                         % (stats["frames"], EXPECTED_FRAMES))
    # A layer that is held but only ever had one drawing would mean the selection
    # has drifted off the layer it was written for.
    for index in indices:
        if (index, 1) in stats["held"]:
            raise SystemExit("layer %d draws only once; it is not the animated "
                             "layer this build expects" % index)
        if not any(index == held for held, _count in stats["held"]):
            raise SystemExit("layer %d is not a drawn layer of the title" % index)
    raw = text.encode("utf-8")
    with open(args.out, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)

    print("%s: %d frames of %d layers, %d unique drawings, %d held still"
          % (args.out, stats["frames"], stats["layers"], stats["definitions"],
             len(stats["held"])))
    print("bytes: %d raw, %d gzipped (definitions %d)"
          % (len(raw), len(gzip.compress(raw, 9)), stats["defs_bytes"]))
    for note in stats["notes"]:
        print("note: %s" % note, file=sys.stderr)


if __name__ == "__main__":
    main()
