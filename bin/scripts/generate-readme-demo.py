import json
from pathlib import Path


def app_version():
    """Read the current version from package.json so the demo never goes stale."""
    try:
        return json.loads(Path("package.json").read_text()).get("version", "")
    except Exception:
        return ""


# The generator hand-builds an animated GIF from a 5x7 bitmap font: no image
# libraries, so it runs anywhere Python does. It renders a *stylised* (uppercase,
# blocky) view of the real Bubble Tea TUI — the layout, labels, tree markers,
# section rules, status-line prompts and modes mirror what the app actually draws
# (see tui/internal/app/render.go and tui/internal/view/response.go).

WIDTH = 700
HEIGHT = 420
SCALE = 2
CHAR_WIDTH = 6 * SCALE
LINE_HEIGHT = 10 * SCALE

COLORS = {
    "bg": 0,
    "fg": 1,
    "dim": 2,
    "green": 3,
    "cyan": 4,
    "yellow": 5,
    "black": 6,
    "bar": 7,
}

PALETTE = [
    (14, 16, 18),
    (232, 236, 239),
    (134, 144, 153),
    (96, 214, 151),
    (94, 200, 255),
    (255, 221, 87),
    (10, 12, 14),
    (24, 27, 31),
]

FONT = {
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
    "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
    '"': ["01010", "01010", "01010", "00000", "00000", "00000", "00000"],
    "#": ["01010", "11111", "01010", "01010", "11111", "01010", "00000"],
    "$": ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
    "%": ["11001", "11010", "00100", "01000", "10110", "00110", "00000"],
    "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
    "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
    "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
    ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
    "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
    "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
    ",": ["00000", "00000", "00000", "00000", "00100", "00100", "01000"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
    ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
    "<": ["00010", "00100", "01000", "10000", "01000", "00100", "00010"],
    "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
    ">": ["01000", "00100", "00010", "00001", "00010", "00100", "01000"],
    "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
    "@": ["01110", "10001", "10111", "10101", "10111", "10000", "01110"],
    "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"],
    "\\": ["10000", "01000", "00100", "00010", "00001", "00000", "00000"],
    "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"],
    "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
    "{": ["00010", "00100", "00100", "01000", "00100", "00100", "00010"],
    "|": ["00100", "00100", "00100", "00100", "00100", "00100", "00100"],
    "}": ["01000", "00100", "00100", "00010", "00100", "00100", "01000"],
    # TUI glyphs: tree markers, separators and scroll hints.
    "→": ["00000", "00100", "00010", "11111", "00010", "00100", "00000"],
    "↓": ["00100", "00100", "00100", "10101", "01110", "00100", "00000"],
    "↑": ["00100", "01110", "10101", "00100", "00100", "00100", "00000"],
    "·": ["00000", "00000", "00000", "01100", "01100", "00000", "00000"],
}

LETTERS = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
}

FONT.update(LETTERS)


def blank_frame():
    return bytearray([COLORS["bg"]] * (WIDTH * HEIGHT))


def rect(frame, x, y, w, h, color):
    for yy in range(max(0, y), min(HEIGHT, y + h)):
        start = yy * WIDTH + max(0, x)
        end = yy * WIDTH + min(WIDTH, x + w)
        frame[start:end] = bytes([color]) * max(0, end - start)


def draw_text(frame, x, y, text, color=COLORS["fg"], background=None):
    cursor = x
    for char in text:
        # A box-drawing horizontal fills the whole cell so runs of it join into a
        # continuous rule (── Request ──), matching view.SectionRule.
        if char == "─":
            rect(frame, cursor, y + 3 * SCALE, CHAR_WIDTH, SCALE, color)
            cursor += CHAR_WIDTH
            continue
        glyph = FONT.get(char if char in FONT else char.upper(), FONT["?"])
        if background is not None:
            rect(frame, cursor - 2, y - 2, CHAR_WIDTH, LINE_HEIGHT, background)
        for row_index, row in enumerate(glyph):
            for col_index, value in enumerate(row):
                if value != "1":
                    continue
                px = cursor + col_index * SCALE
                py = y + row_index * SCALE
                rect(frame, px, py, SCALE, SCALE, color)
        cursor += CHAR_WIDTH


def hline(frame, x, y, w, color=COLORS["dim"]):
    rect(frame, x, y, w, SCALE, color)


def vline(frame, x, y, h, color=COLORS["dim"]):
    rect(frame, x, y, SCALE, h, color)


def draw_box(frame, x, y, w, h, title=None, color=COLORS["dim"]):
    hline(frame, x, y, w, color)
    hline(frame, x, y + h, w, color)
    vline(frame, x, y, h, color)
    vline(frame, x + w, y, h + SCALE, color)
    if title:
        draw_text(frame, x + 16, y - 8, f" {title} ", COLORS["fg"], COLORS["bg"])


def draw_rows(frame, x, y, rows, width_chars):
    cursor_y = y
    for row in rows:
        if isinstance(row, tuple):
            text, color, bg = row
        else:
            text, color, bg = row, COLORS["fg"], None
        draw_text(frame, x, cursor_y, text[:width_chars], color, bg)
        cursor_y += LINE_HEIGHT


def rule(label, total=30):
    """Section divider like view.SectionRule: '── label ─────'."""
    body = f"── {label} "
    return body + "─" * max(0, total - len(body))


def sel(text, width):
    """A reverse-video (selected) row: dark text on a light bar, padded to width."""
    return (text.ljust(width), COLORS["black"], COLORS["fg"])


HEADER_Y = 14
PANE_Y = 44
PANE_H = 318
LEFT_X = 14
LEFT_W = 210
RIGHT_X = 238
RIGHT_W = 448
STATUS_Y = 392
SIDEBAR_CHARS = 16
RESULT_CHARS = 35


def draw_ai_overlay(frame, scene):
    x, y, w, h = 118, 78, 464, 252
    rect(frame, x - 6, y - 6, w + 12, h + 12, COLORS["bg"])
    draw_box(frame, x, y, w, h, color=COLORS["yellow"])
    draw_text(frame, x - 10, y - 8, "ESC", COLORS["fg"], COLORS["dim"])
    draw_text(frame, x + (w // 2) - 42, y - 8, " CLAUDE ", COLORS["yellow"], COLORS["bg"])
    draw_rows(frame, x + 16, y + 22, scene["ai"], 38)


def draw_app(scene):
    frame = blank_frame()
    rect(frame, 0, 0, WIDTH, HEIGHT, COLORS["bg"])

    # Header — one line: "ntee-r1quest {version}  ·  root: {root}" (render.go:22).
    header = f"ntee-r1quest v{app_version()}  ·  root: example/request"
    draw_text(frame, LEFT_X + 2, HEADER_Y, header, COLORS["green"])

    # Two untitled bordered panes: sidebar (request tree) + result/detail.
    draw_box(frame, LEFT_X, PANE_Y, LEFT_W, PANE_H, color=COLORS["dim"])
    draw_box(frame, RIGHT_X, PANE_Y, RIGHT_W, PANE_H, color=COLORS["dim"])
    draw_rows(frame, LEFT_X + 12, PANE_Y + 16, scene["sidebar"], SIDEBAR_CHARS)
    draw_rows(frame, RIGHT_X + 14, PANE_Y + 16, scene["result"], RESULT_CHARS)

    # Status line (mode-dependent prompt), render.go:renderStatusLine.
    draw_text(frame, LEFT_X + 2, STATUS_Y, scene["status"], COLORS["cyan"])

    if scene.get("ai"):
        draw_ai_overlay(frame, scene)

    return frame


def lzw_image_data(pixels):
    # Standard GIF LZW with a growing dictionary. Real compression matters here:
    # the frames are mostly one flat background colour, so runs collapse to a
    # handful of codes (a naive clear-before-every-pixel encoder would balloon
    # the file to megabytes). min_code_size is 3 for our 8-colour palette.
    min_code_size = 3
    clear = 1 << min_code_size
    end = clear + 1
    code_size = min_code_size + 1
    bit_buffer = 0
    bit_count = 0
    out = bytearray()

    def write_code(code):
        nonlocal bit_buffer, bit_count
        bit_buffer |= code << bit_count
        bit_count += code_size
        while bit_count >= 8:
            out.append(bit_buffer & 0xFF)
            bit_buffer >>= 8
            bit_count -= 8

    def new_table():
        return {(pixel,): pixel for pixel in range(clear)}

    table = new_table()
    next_code = end + 1
    write_code(clear)

    buffer = ()
    for pixel in pixels:
        candidate = buffer + (pixel,)
        if candidate in table:
            buffer = candidate
            continue
        write_code(table[buffer])
        if next_code < 4096:
            table[candidate] = next_code
            next_code += 1
            # GIF "early change": widen the code one step AFTER the table grows
            # past the current width (next_code > 1<<code_size), so the decoder —
            # which lags by one entry — stays in lockstep. Using == desyncs and
            # yields a "broken data stream".
            if next_code > (1 << code_size) and code_size < 12:
                code_size += 1
        else:
            # Dictionary full: reset so decoding stays bounded (rare — the demo
            # frames use far fewer codes than 4096).
            write_code(clear)
            table = new_table()
            next_code = end + 1
            code_size = min_code_size + 1
        buffer = (pixel,)

    if buffer:
        write_code(table[buffer])
    write_code(end)

    if bit_count:
        out.append(bit_buffer & 0xFF)

    blocks = bytearray([min_code_size])
    for index in range(0, len(out), 255):
        block = out[index : index + 255]
        blocks.append(len(block))
        blocks.extend(block)
    blocks.append(0)
    return blocks


def write_gif(path, frames, delay=140):
    data = bytearray()
    data.extend(b"GIF89a")
    data.extend(WIDTH.to_bytes(2, "little"))
    data.extend(HEIGHT.to_bytes(2, "little"))
    data.append(0xF2)
    data.append(COLORS["bg"])
    data.append(0)
    for red, green, blue in PALETTE:
        data.extend(bytes([red, green, blue]))

    data.extend(b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00")

    for frame in frames:
        data.extend(b"\x21\xf9\x04\x00")
        data.extend(delay.to_bytes(2, "little"))
        data.extend(b"\x00\x00")
        data.extend(b"\x2c\x00\x00\x00\x00")
        data.extend(WIDTH.to_bytes(2, "little"))
        data.extend(HEIGHT.to_bytes(2, "little"))
        data.append(0)
        data.extend(lzw_image_data(frame))

    data.append(0x3B)
    path.write_bytes(data)


# The example/request tree (folder-1 expanded, get-post highlighted). Directory
# markers are → collapsed / ↓ expanded; files are indented two spaces per depth
# (filetree.go:FormatFileTreeEntryLabel).
TREE_SIDEBAR = [
    ("↓ folder-1", COLORS["cyan"], None),
    "    create-post",
    sel("    get-post", SIDEBAR_CHARS),
    ("→ folder-2", COLORS["cyan"], None),
    ("→ mutations", COLORS["cyan"], None),
    ("→ queries", COLORS["cyan"], None),
    "  example",
    "  example-upload",
]

# A run response, exactly as view.FormatResponse lays it out.
RESPONSE_RESULT = [
    "posts/1 [GET]",
    ("200 OK  ·  128 ms", COLORS["green"], None),
    "",
    (rule("Request"), COLORS["dim"], None),
    "URL     @i(host)/posts/1",
    "Method  GET",
    "",
    (rule("Response"), COLORS["dim"], None),
    "Status  200 OK",
    "",
    "Headers",
    "  content-type: application/json",
    "",
    "Body",
    '  { "title": "delectus aut..." }',
]

# The .nts source in edit/search mode (line-numbered gutter).
SOURCE_RESULT = [
    "1 | ref ../../data/example.ntd",
    "2 |",
    ('3 | url "@i(host)/posts/1"', COLORS["yellow"], None),
    ("4 | type get", COLORS["cyan"], None),
    "5 |",
    "6 | header accept, @i(content-type)",
    "7 | header content-type,",
    "8 |   @i(content-type)",
]


def search_result():
    rows = list(SOURCE_RESULT)
    # Highlight the matched "content-type" line (row index 5).
    rows[5] = sel("6 | header accept, @i(content-type)", RESULT_CHARS)
    return rows


SCENES = [
    # 1. Query mode: browse the tree, Enter runs the selected request.
    {
        "sidebar": TREE_SIDEBAR,
        "result": RESPONSE_RESULT,
        "status": "@query >  ·  ↑/↓ browse · enter run",
    },
    # 2. View mode: read-only response, hotkeys to edit/search.
    {
        "sidebar": TREE_SIDEBAR,
        "result": RESPONSE_RESULT,
        "status": "@view get-post   e edit · s search · esc back",
    },
    # 3. Edit mode: the * marks unsaved changes; ^S saves, esc discards.
    {
        "sidebar": TREE_SIDEBAR,
        "result": SOURCE_RESULT,
        "status": "@edit get-post*   ^S save · esc discard",
    },
    # 4. Search mode: step through matches inside the open buffer.
    {
        "sidebar": TREE_SIDEBAR,
        "result": search_result(),
        "status": "@search /content-type/   1/2   ↑/↓ next · esc back",
    },
    # 5. History mode: sidebar becomes cached endpoints; detail adds a Trace id.
    {
        "sidebar": [
            sel("GET /posts/1", SIDEBAR_CHARS),
            "POST /posts",
            "GET /todos/1",
            "GET /users/1",
        ],
        "result": [
            "posts/1 [GET]",
            ("200 OK  ·  128 ms", COLORS["green"], None),
            ("Trace: 5f3ac91b", COLORS["dim"], None),
            "",
            (rule("Request"), COLORS["dim"], None),
            "URL     @i(host)/posts/1",
            "Method  GET",
            "",
            (rule("Response"), COLORS["dim"], None),
            "Status  200 OK",
            "",
            "Body",
            '  { "title": "delectus aut..." }',
        ],
        "status": "@history 1/4   ↑/↓ scroll · s search · esc back",
    },
    # 6. AI mode: a Claude chat overlay that can edit and run requests for you.
    {
        "sidebar": TREE_SIDEBAR,
        "result": RESPONSE_RESULT,
        "status": "@ai >  ·  shift+tab cycles modes",
        "ai": [
            "USER: add an accept header and run it",
            "",
            "CLAUDE: edited folder-1/get-post.nts",
            "+ header accept, application/json",
            ("ran it → 200 OK (shown in result)", COLORS["green"], None),
            "",
            ("──────── above is history ────────", COLORS["dim"], None),
            ("Ask the agent something, press enter.", COLORS["dim"], None),
        ],
    },
]


def main():
    frames = []
    for scene in SCENES:
        frames.extend([draw_app(scene)] * 2)
    output = Path("docs/assets/readme-demo.gif")
    output.parent.mkdir(parents=True, exist_ok=True)
    write_gif(output, frames)


if __name__ == "__main__":
    main()
