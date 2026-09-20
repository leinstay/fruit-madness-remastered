#!/usr/bin/env python3
"""Converts drawings from the original 2013 Flash source document (.fla) to SVG.

The game's artwork was drawn as vectors in a Flash document. That document is the
authoritative source for every shape in the game, and this tool reads it directly:
it walks the XFL document tree inside the .fla, turns the stored edge records of a
library item into SVG paths and writes one SVG per timeline frame.

    python tools/xfl2svg.py <document.fla> <LibraryItem> --out file.svg [--frame N]

`<LibraryItem>` is the library path of the symbol without its extension, for example
"Images/Menu" or "Buttons/StartButton". `--frame` is a timeline tick (0 by default);
`--list` prints the library instead of converting anything.

The Flash document is the artists' working file and is not part of this repository,
so its path is always given on the command line.

What is converted
-----------------
* `DOMShape` fills (`SolidColor`) and strokes (`SolidStroke`). Fill regions are
  assembled from Flash's half-edge convention — every edge names the fill on its
  left (`fillStyle0`) and on its right (`fillStyle1`) — by walking the `fillStyle1`
  edges as drawn and the `fillStyle0` edges reversed, joining them into closed loops
  and emitting one `fill-rule="evenodd"` path per fill style.
* The edge grammar: `!` move, `|` and `/` line, `[` quadratic, coordinates in twips
  either as decimals or as `#hex` fixed point (six hex digits and two fractional
  ones, a signed 32-bit integer of 1/256 twip), `S` selection tokens skipped.
* `DOMGroup` nesting with its matrices, and `DOMBitmapInstance` for embedded images
  (the bytes come from `--bitmap`, see below).
* Layer stacking (the last layer of the timeline is drawn first) and per-frame
  keyframe lookup, so any tick of an animation can be rendered.

Text is not converted. Every caption in the original is an editable text field in the
game's own pixel font, and the game draws them at runtime with that font.

Coordinates are written in pixels with two decimals. Flash stores them as whole twips
(1/20 px), so two decimals are exact. Quadratics that never leave their chord by more
than half a twip are written as straight lines: that is below the format's own
resolution, and it makes the output noticeably smaller.

Options
-------
  --frame N              timeline tick to convert (default 0)
  --out FILE             where to write the SVG (required unless --list)
  --list                 print the library items of the document and exit
  --viewbox "x y w h"    viewport in px; the default is the union of the bounds over
                         every keyframe of the symbol, which is the box the symbol
                         occupies over its whole animation
  --bitmap NAME=FILE     supply the bytes of an embedded image: NAME is the library
                         name of the bitmap, FILE a PNG on disk. May be repeated
  --straight-tol T       the straightening tolerance in twips (-1 disables it)
"""

import argparse
import base64
import os
import re
import struct
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xfl_zip  # noqa: E402

NS = "{http://ns.adobe.com/xfl/2008/}"

# ------------------------------------------------------------------ numbers --

# Coordinates are twips. Hex literals carry 1/256 of a twip, so points are keyed
# on exact integers in 1/256-twip units and loop joining can compare them exactly.
SUB = 256
TWIPS_PER_PX = 20.0

# Half a twip: below the resolution Flash itself stores coordinates at, so a curve
# that stays this close to its chord is a straight line as far as the format is
# concerned.
DEFAULT_STRAIGHT_TOL = 0.5


def parse_number(token):
    """One XFL edge number -> twips."""
    if token[0] == "#":
        parts = token[1:].split(".")
        whole, frac = parts[0], (parts[1] if len(parts) > 1 else "")
        packed = "{:0>6}{:0<2}".format(whole, frac)
        return int.from_bytes(bytes.fromhex(packed), "big", signed=True) / 256.0
    return float(token)


TOKEN_RE = re.compile(r"[!|/\[]|S\d+|#[0-9A-Fa-f]*\.?[0-9A-Fa-f]+|-?\d+(?:\.\d+)?")


def point_key(point):
    return (round(point[0] * SUB), round(point[1] * SUB))


def parse_edges(edges):
    """An `edges` attribute -> a list of point sequences.

    A sequence is `[start, seg, seg, ...]` where a segment is `('L', (x, y))` or
    `('Q', (cx, cy), (x, y))`. Every move token starts a new sequence.
    """
    tokens = TOKEN_RE.findall(edges)
    sequences = []
    current = None
    i = 0
    n = len(tokens)
    while i < n:
        token = tokens[i]
        if token[0] == "S":
            i += 1
        elif token == "!":
            current = [(parse_number(tokens[i + 1]), parse_number(tokens[i + 2]))]
            sequences.append(current)
            i += 3
        elif token in ("|", "/"):
            current.append(("L", (parse_number(tokens[i + 1]),
                                  parse_number(tokens[i + 2]))))
            i += 3
        elif token == "[":
            current.append(("Q", (parse_number(tokens[i + 1]),
                                  parse_number(tokens[i + 2])),
                            (parse_number(tokens[i + 3]),
                             parse_number(tokens[i + 4]))))
            i += 5
        else:
            raise ValueError("unexpected token %r in %r" % (token, edges[:80]))
    return [s for s in sequences if len(s) > 1]


def reverse_sequence(seq):
    """Reverse a point sequence, keeping the quadratic control points."""
    points = [seq[0]] + [s[-1] for s in seq[1:]]
    out = [points[-1]]
    for i in range(len(seq) - 1, 0, -1):
        segment = seq[i]
        if segment[0] == "L":
            out.append(("L", points[i - 1]))
        else:
            out.append(("Q", segment[1], points[i - 1]))
    return out


def sequence_end(seq):
    return seq[-1][-1]


# ----------------------------------------------------------------- matrices --

IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def matrix_multiply(m, n):
    a1, b1, c1, d1, e1, f1 = m
    a2, b2, c2, d2, e2, f2 = n
    return (a1 * a2 + c1 * b2,
            b1 * a2 + d1 * b2,
            a1 * c2 + c1 * d2,
            b1 * c2 + d1 * d2,
            a1 * e2 + c1 * f2 + e1,
            b1 * e2 + d1 * f2 + f1)


def matrix_apply(m, x, y):
    a, b, c, d, e, f = m
    return (a * x + c * y + e, b * x + d * y + f)


def read_matrix(element):
    """`<matrix><Matrix .../></matrix>` -> a matrix in pixels."""
    if element is None:
        return IDENTITY
    matrix = element.find(NS + "Matrix")
    if matrix is None:
        return IDENTITY
    get = matrix.get
    return (float(get("a", 1)), float(get("b", 0)), float(get("c", 0)),
            float(get("d", 1)), float(get("tx", 0)), float(get("ty", 0)))


# ------------------------------------------------------------------- styles --

def read_fills(shape):
    out = {}
    fills = shape.find(NS + "fills")
    if fills is None:
        return out
    for style in fills.findall(NS + "FillStyle"):
        index = int(style.get("index"))
        solid = style.find(NS + "SolidColor")
        if solid is not None:
            out[index] = ("solid", solid.get("color", "#000000").lower(),
                          float(solid.get("alpha", 1)))
        else:
            out[index] = ("unsupported",
                          [child.tag.replace(NS, "") for child in style], 1.0)
    return out


def read_strokes(shape):
    out = {}
    strokes = shape.find(NS + "strokes")
    if strokes is None:
        return out
    for style in strokes.findall(NS + "StrokeStyle"):
        index = int(style.get("index"))
        solid = style.find(NS + "SolidStroke")
        if solid is None:
            out[index] = None
            continue
        fill = solid.find(NS + "fill")
        color, alpha = "#000000", 1.0
        if fill is not None:
            paint = fill.find(NS + "SolidColor")
            if paint is not None:
                color = paint.get("color", "#000000").lower()
                alpha = float(paint.get("alpha", 1))
        out[index] = {
            "weight": float(solid.get("weight", 1)),
            "color": color,
            "alpha": alpha,
            "caps": solid.get("caps", "round"),
            "joints": solid.get("joints", "round"),
        }
    return out


# ------------------------------------------------------------- loop joining --

def join_loops(sequences):
    """Join point sequences end-to-start into closed loops (exact matches only)."""
    pool = {}
    for seq in sequences:
        pool.setdefault(point_key(seq[0]), []).append(seq)
    loops = []
    remaining = sum(len(v) for v in pool.values())
    while remaining:
        start = next(k for k, v in pool.items() if v)
        seq = pool[start].pop()
        remaining -= 1
        loop = list(seq)
        while True:
            key = point_key(sequence_end(loop))
            if key == point_key(loop[0]):
                break
            nxt = pool.get(key)
            if not nxt:
                break   # an open chain: emit it as it is
            seq = nxt.pop()
            remaining -= 1
            loop.extend(seq[1:])
        loops.append(loop)
    return loops


def chain_strokes(sequences):
    """Join stroke sequences into continuous chains, marking the closed ones."""
    pool = {}
    for seq in sequences:
        pool.setdefault(point_key(seq[0]), []).append(seq)
    chains = []
    remaining = sum(len(v) for v in pool.values())
    while remaining:
        start = next(k for k, v in pool.items() if v)
        seq = pool[start].pop()
        remaining -= 1
        chain = list(seq)
        while True:
            key = point_key(sequence_end(chain))
            if key == point_key(chain[0]):
                chains.append((chain, True))
                break
            nxt = pool.get(key)
            if not nxt:
                chains.append((chain, False))
                break
            seq = nxt.pop()
            remaining -= 1
            chain.extend(seq[1:])
    return chains


# ------------------------------------------------------------------ writing --

def fmt(value):
    """A pixel coordinate with two decimals and no trailing zeros."""
    text = "%.2f" % value
    if text == "-0.00":
        text = "0.00"
    return text.rstrip("0").rstrip(".") if "." in text else text


def fmt_alpha(value):
    return ("%.4f" % value).rstrip("0").rstrip(".")


def straighten(loop, tolerance):
    """Replace quadratics that never leave their chord by line segments."""
    if tolerance < 0:
        return loop
    out = [loop[0]]
    previous = loop[0]
    for segment in loop[1:]:
        if segment[0] == "Q":
            (cx, cy), (x, y) = segment[1], segment[2]
            ax, ay = previous
            dx, dy = x - ax, y - ay
            chord = (dx * dx + dy * dy) ** 0.5
            if chord > 0:
                # How far the curve's apex sits off the chord.
                deviation = abs(dx * (cy - ay) - dy * (cx - ax)) / chord / 2.0
                # ... and whether it overshoots either end along the chord.
                along = (dx * (cx - ax) + dy * (cy - ay)) / chord
                low, high = 0.0, chord
                denominator = along * 2 - chord
                if denominator != 0:
                    t = along / denominator
                    if 0 < t < 1:
                        v = 2 * (1 - t) * t * along + t * t * chord
                        low, high = min(low, v), max(high, v)
                if (deviation <= tolerance and low >= -tolerance
                        and high <= chord + tolerance):
                    segment = ("L", (x, y))
        out.append(segment)
        previous = segment[-1]
    return out


def loops_to_path(loops, tolerance, close=True):
    parts = []
    for loop in (straighten(lp, tolerance) for lp in loops):
        pieces = ["M%s %s" % (fmt(loop[0][0] / TWIPS_PER_PX),
                              fmt(loop[0][1] / TWIPS_PER_PX))]
        mode = None
        for segment in loop[1:]:
            if segment[0] == "L":
                if mode != "L":
                    pieces.append("L")
                    mode = "L"
                pieces.append("%s %s" % (fmt(segment[1][0] / TWIPS_PER_PX),
                                         fmt(segment[1][1] / TWIPS_PER_PX)))
            else:
                if mode != "Q":
                    pieces.append("Q")
                    mode = "Q"
                pieces.append("%s %s %s %s"
                              % (fmt(segment[1][0] / TWIPS_PER_PX),
                                 fmt(segment[1][1] / TWIPS_PER_PX),
                                 fmt(segment[2][0] / TWIPS_PER_PX),
                                 fmt(segment[2][1] / TWIPS_PER_PX)))
        data = pieces[0] + " " + " ".join(pieces[1:]) if len(pieces) > 1 else pieces[0]
        data = re.sub(r"([LQ]) ", r"\1", data)
        if close:
            data += " Z"
        parts.append(data)
    return " ".join(parts)


# ------------------------------------------------------------------ bounds ---

def quadratic_extrema(p0, p1, p2):
    """The bounding box of a quadratic Bezier."""
    xs = [p0[0], p2[0]]
    ys = [p0[1], p2[1]]
    for axis, (a, b, c) in enumerate(((p0[0], p1[0], p2[0]),
                                      (p0[1], p1[1], p2[1]))):
        denominator = a - 2 * b + c
        if denominator != 0:
            t = (a - b) / denominator
            if 0 < t < 1:
                v = (1 - t) ** 2 * a + 2 * (1 - t) * t * b + t ** 2 * c
                (xs if axis == 0 else ys).append(v)
    return min(xs), min(ys), max(xs), max(ys)


class Box:
    """An accumulating bounding box in twips."""

    def __init__(self):
        self.x0 = self.y0 = float("inf")
        self.x1 = self.y1 = float("-inf")

    def add(self, x0, y0, x1=None, y1=None):
        if x1 is None:
            x1, y1 = x0, y0
        self.x0 = min(self.x0, x0)
        self.y0 = min(self.y0, y0)
        self.x1 = max(self.x1, x1)
        self.y1 = max(self.y1, y1)

    def grow(self, radius):
        self.x0 -= radius
        self.y0 -= radius
        self.x1 += radius
        self.y1 += radius

    def union(self, other):
        if not other.empty():
            self.add(other.x0, other.y0, other.x1, other.y1)

    def empty(self):
        return self.x0 > self.x1

    def pixels(self):
        return (self.x0 / TWIPS_PER_PX, self.y0 / TWIPS_PER_PX,
                self.x1 / TWIPS_PER_PX, self.y1 / TWIPS_PER_PX)


def sequence_box(seq, box):
    previous = seq[0]
    box.add(previous[0], previous[1])
    for segment in seq[1:]:
        if segment[0] == "L":
            box.add(segment[1][0], segment[1][1])
            previous = segment[1]
        else:
            box.add(*quadratic_extrema(previous, segment[1], segment[2]))
            previous = segment[2]


# -------------------------------------------------------------- conversion ---

def png_size(path):
    """Width and height out of a PNG's IHDR chunk."""
    with open(path, "rb") as fh:
        head = fh.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        raise SystemExit("%s is not a PNG" % path)
    return struct.unpack(">II", head[16:24])


def data_uri(path):
    with open(path, "rb") as fh:
        return "data:image/png;base64," + base64.b64encode(fh.read()).decode("ascii")


class Converter:
    """Turns XFL elements into SVG fragments.

    `bitmaps` maps a bitmap's library name to `(href, width, height)`.
    `notes` collects everything the conversion had to skip.
    """

    def __init__(self, bitmaps=None, straight_tol=DEFAULT_STRAIGHT_TOL):
        self.bitmaps = bitmaps or {}
        self.straight_tol = straight_tol
        self.notes = set()

    # -- one shape ---------------------------------------------------------
    def shape(self, shape, matrix, box, out):
        fills = read_fills(shape)
        strokes = read_strokes(shape)
        edges = shape.find(NS + "edges")
        if edges is None:
            return
        fill_sequences = {}
        stroke_sequences = {}
        for edge in edges.findall(NS + "Edge"):
            raw = edge.get("edges")
            if raw is None:
                continue        # a `cubics` hint edge: no geometry of its own
            try:
                sequences = parse_edges(raw)
            except ValueError as exc:
                self.notes.add("edge parse error: %s" % exc)
                continue
            if matrix != IDENTITY:
                sequences = [self.transform(s, matrix) for s in sequences]
            left = edge.get("fillStyle0")
            right = edge.get("fillStyle1")
            stroke = edge.get("strokeStyle")
            if right is not None:
                fill_sequences.setdefault(int(right), []).extend(sequences)
            if left is not None:
                fill_sequences.setdefault(int(left), []).extend(
                    reverse_sequence(s) for s in sequences)
            if stroke is not None:
                stroke_sequences.setdefault(int(stroke), []).extend(sequences)

        for index in sorted(fill_sequences):
            style = fills.get(index)
            if style is None:
                self.notes.add("missing FillStyle %d" % index)
                continue
            if style[0] != "solid":
                self.notes.add("unsupported fill %r" % (style[1],))
                continue
            loops = join_loops(fill_sequences[index])
            for loop in loops:
                sequence_box(loop, box)
            data = loops_to_path(loops, self.straight_tol, close=True)
            if not data:
                continue
            attrs = 'fill="%s"' % style[1]
            if style[2] != 1:
                attrs += ' fill-opacity="%s"' % fmt_alpha(style[2])
            out.append('<path %s fill-rule="evenodd" d="%s"/>' % (attrs, data))

        for index in sorted(stroke_sequences):
            style = strokes.get(index)
            if style is None:
                self.notes.add("missing StrokeStyle %d" % index)
                continue
            chains = chain_strokes(stroke_sequences[index])
            stroke_box = Box()
            for chain, _closed in chains:
                sequence_box(chain, stroke_box)
            if not stroke_box.empty():
                stroke_box.grow(style["weight"] * TWIPS_PER_PX / 2.0)
                box.union(stroke_box)
            data = " ".join(loops_to_path([chain], self.straight_tol, close=closed)
                            for chain, closed in chains)
            attrs = ('fill="none" stroke="%s" stroke-width="%s" '
                     'stroke-linecap="%s" stroke-linejoin="%s"'
                     % (style["color"], fmt(style["weight"]),
                        style["caps"], style["joints"]))
            if style["alpha"] != 1:
                attrs += ' stroke-opacity="%s"' % fmt_alpha(style["alpha"])
            out.append('<path %s d="%s"/>' % (attrs, data))

    @staticmethod
    def transform(seq, matrix):
        """Apply a pixel matrix to a sequence given in twips."""
        def point(p):
            x, y = matrix_apply(matrix, p[0] / TWIPS_PER_PX, p[1] / TWIPS_PER_PX)
            return (x * TWIPS_PER_PX, y * TWIPS_PER_PX)

        out = [point(seq[0])]
        for segment in seq[1:]:
            if segment[0] == "L":
                out.append(("L", point(segment[1])))
            else:
                out.append(("Q", point(segment[1]), point(segment[2])))
        return out

    # -- a container of elements -------------------------------------------
    def elements(self, container, matrix, box, out):
        for element in container:
            tag = element.tag.replace(NS, "")
            if tag == "DOMShape":
                self.shape(element, matrix, box, out)
            elif tag == "DOMGroup":
                inner = matrix_multiply(matrix, read_matrix(element.find(NS + "matrix")))
                members = element.find(NS + "members")
                if members is not None:
                    self.elements(members, inner, box, out)
            elif tag == "DOMBitmapInstance":
                self.bitmap(element, matrix, box, out)
            elif tag in ("DOMStaticText", "DOMDynamicText", "DOMInputText"):
                # Captions are drawn at runtime in the game's own font.
                self.notes.add("text field skipped (drawn at runtime)")
            elif tag == "DOMSymbolInstance":
                self.notes.add("DOMSymbolInstance (nested symbol) not expanded")
            else:
                self.notes.add("unhandled element <%s>" % tag)

    def bitmap(self, element, matrix, box, out):
        name = element.get("libraryItemName", "")
        placed = matrix_multiply(matrix, read_matrix(element.find(NS + "matrix")))
        known = self.bitmaps.get(name)
        if known is None:
            self.notes.add("no bytes supplied for bitmap %s (use --bitmap)" % name)
            return
        href, width, height = known
        box.add(*[v * TWIPS_PER_PX for v in matrix_apply(placed, 0, 0)])
        box.add(*[v * TWIPS_PER_PX for v in matrix_apply(placed, width, height)])
        out.append('<image x="0" y="0" width="%s" height="%s" '
                   'transform="matrix(%s)" xlink:href="%s" '
                   'preserveAspectRatio="none" '
                   'style="image-rendering:pixelated"/>'
                   % (fmt(width), fmt(height),
                      ",".join(fmt(v) for v in placed), href))


# ---------------------------------------------------------------- timeline ---

def layer_list(timeline):
    layers = timeline.find(NS + "layers")
    return layers.findall(NS + "DOMLayer") if layers is not None else []


def is_drawable_layer(layer):
    """Folders, guides and hidden layers carry nothing that is drawn."""
    return (layer.get("layerType") not in ("folder", "guide")
            and layer.get("visible") != "false")


def keyframes_of(layer):
    """`[(index, duration), ...]` for one layer, in timeline order."""
    frames = layer.find(NS + "frames")
    if frames is None:
        return []
    return [(int(f.get("index")), int(f.get("duration", 1)))
            for f in frames.findall(NS + "DOMFrame")]


def frame_for(layer, tick):
    """The `DOMFrame` of `layer` that is showing on `tick`, or None."""
    frames = layer.find(NS + "frames")
    if frames is None:
        return None
    for frame in frames.findall(NS + "DOMFrame"):
        index = int(frame.get("index"))
        if index <= tick < index + int(frame.get("duration", 1)):
            return frame
    return None


def keyframe_ticks(timeline):
    """Every tick at which any layer changes — the animation's real frames."""
    ticks = set()
    for layer in layer_list(timeline):
        for index, _duration in keyframes_of(layer):
            ticks.add(index)
    return sorted(ticks)


def render_layers(converter, timeline, tick):
    """`[(index, name, [fragments], Box)]` for one tick, in drawing order.

    The timeline lists layers top first, so drawing order is the reverse.
    """
    out = []
    layers = layer_list(timeline)
    for index in range(len(layers) - 1, -1, -1):
        layer = layers[index]
        if not is_drawable_layer(layer):
            continue
        frame = frame_for(layer, tick)
        if frame is None:
            continue
        elements = frame.find(NS + "elements")
        if elements is None or len(elements) == 0:
            continue
        fragments = []
        box = Box()
        converter.elements(elements, IDENTITY, box, fragments)
        if fragments:
            out.append((index, layer.get("name", ""), fragments, box))
    return out


# -------------------------------------------------------------- the document --

MISSING_FLA = """\
%s: no such file.

The original 2013 Flash source document (.fla) is the artists' working file and is
not part of this repository, so its path has to be given on the command line:

    python tools/%s <path-to-the-fla> ...
"""


def open_document(path):
    """The archive of a .fla as `{name: bytes}`, with a helpful error if missing."""
    if not os.path.isfile(path):
        raise SystemExit(MISSING_FLA % (path, os.path.basename(sys.argv[0])))
    data = xfl_zip.read_map(path)
    if not any(name.startswith("LIBRARY/") for name in data):
        raise SystemExit("%s does not look like a Flash source document: "
                         "no LIBRARY entries" % path)
    return data


def library_items(data):
    """The library paths inside the document, without the .xml extension."""
    return sorted(name[len("LIBRARY/"):-len(".xml")] for name in data
                  if name.startswith("LIBRARY/") and name.endswith(".xml"))


def load_symbol(data, item, path):
    """The `DOMTimeline` of one library item."""
    entry = "LIBRARY/%s.xml" % item
    if entry not in data:
        raise SystemExit("%s: no library item %r. Use --list to see them all."
                         % (path, item))
    root = ET.fromstring(data[entry].decode("utf-8"))
    timeline = root.find(NS + "timeline")
    if timeline is None:
        raise SystemExit("%s: %r has no timeline" % (path, item))
    return timeline.find(NS + "DOMTimeline")


def svg_document(body, viewbox):
    x, y, width, height = viewbox
    return ('<svg xmlns="http://www.w3.org/2000/svg" '
            'xmlns:xlink="http://www.w3.org/1999/xlink" '
            'width="%s" height="%s" viewBox="0 0 %s %s">'
            '<g transform="translate(%s,%s)">%s</g></svg>'
            % (fmt(width), fmt(height), fmt(width), fmt(height),
               fmt(-x), fmt(-y), "".join(body)))


def symbol_bounds(converter, timeline):
    """The union of the bounds over every keyframe, in px."""
    whole = Box()
    for tick in keyframe_ticks(timeline):
        for _index, _name, _fragments, box in render_layers(converter, timeline, tick):
            whole.union(box)
    if whole.empty():
        raise SystemExit("the symbol draws nothing")
    x0, y0, x1, y1 = whole.pixels()
    return (x0, y0, x1 - x0, y1 - y0)


# ------------------------------------------------------------------- main ----

def parse_bitmap_option(values):
    bitmaps = {}
    for value in values or []:
        if "=" not in value:
            raise SystemExit("--bitmap needs NAME=FILE, got %r" % value)
        name, file = value.split("=", 1)
        if not os.path.isfile(file):
            raise SystemExit("--bitmap: no such file %s" % file)
        width, height = png_size(file)
        bitmaps[name] = (data_uri(file), float(width), float(height))
    return bitmaps


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Converts drawings from the original 2013 Flash source "
                    "document (.fla) to SVG.")
    parser.add_argument("fla", help="path to the .fla (not part of this repository)")
    parser.add_argument("item", nargs="?", help='library path, e.g. "Images/Menu"')
    parser.add_argument("--out", help="the SVG file to write")
    parser.add_argument("--frame", type=int, default=0, help="timeline tick")
    parser.add_argument("--list", action="store_true",
                        help="print the library items and exit")
    parser.add_argument("--viewbox", help='"x y w h" in px; overrides the bounds')
    parser.add_argument("--bitmap", action="append", metavar="NAME=FILE",
                        help="bytes for an embedded image")
    parser.add_argument("--straight-tol", type=float, default=DEFAULT_STRAIGHT_TOL,
                        help="straightening tolerance in twips (-1 disables it)")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    data = open_document(args.fla)
    if args.list:
        for item in library_items(data):
            print(item)
        return
    if not args.item or not args.out:
        parser.error("an item and --out are required unless --list is given")

    timeline = load_symbol(data, args.item, args.fla)
    bitmaps = parse_bitmap_option(args.bitmap)
    converter = Converter(bitmaps, args.straight_tol)

    if args.viewbox:
        viewbox = [float(v) for v in args.viewbox.replace(",", " ").split()]
        if len(viewbox) != 4:
            parser.error('--viewbox needs four numbers: "x y w h"')
    else:
        viewbox = symbol_bounds(Converter(bitmaps, args.straight_tol), timeline)

    fragments = []
    for _index, _name, part, _box in render_layers(converter, timeline, args.frame):
        fragments.extend(part)
    text = svg_document(fragments, viewbox)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(text)
    if not args.quiet:
        print("%s  frame %d  %sx%s px  %d B"
              % (args.out, args.frame, fmt(viewbox[2]), fmt(viewbox[3]),
                 len(text.encode("utf-8"))))
    for note in sorted(converter.notes):
        print("note: %s" % note, file=sys.stderr)


if __name__ == "__main__":
    main()
