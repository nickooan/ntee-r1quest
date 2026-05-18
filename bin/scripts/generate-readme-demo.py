from pathlib import Path

WIDTH = 620
HEIGHT = 340
SCALE = 2
CHAR_WIDTH = 6 * SCALE
LINE_HEIGHT = 10 * SCALE
LEFT = 24
TOP = 22

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
    (31, 31, 31),
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
    "}": ["01000", "00100", "00100", "00010", "00100", "00100", "01000"],
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
        glyph = FONT.get(char.upper(), FONT["?"])
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


def draw_modal(frame, modal):
    x = 96
    y = 70
    w = 430
    h = 210
    rect(frame, x - 6, y - 6, w + 12, h + 12, COLORS["bg"])
    draw_box(frame, x, y, w, h, color=COLORS["fg"])
    draw_text(frame, x - 10, y - 8, "ESC", COLORS["fg"], COLORS["dim"])
    title = modal["title"]
    title_x = x + max(40, (w // 2) - (len(title) * CHAR_WIDTH // 2))
    draw_text(frame, title_x, y - 8, title, COLORS["fg"], COLORS["bg"])
    draw_rows(frame, x + 12, y + 22, modal["lines"], 32)

    if modal.get("save"):
        sx = x + 142
        sy = y + 74
        sw = 150
        sh = 70
        rect(frame, sx - 4, sy - 4, sw + 8, sh + 8, COLORS["bg"])
        draw_box(frame, sx, sy, sw, sh, color=COLORS["fg"])
        draw_text(frame, sx + 28, sy + 18, "SAVE IT?", COLORS["fg"])
        draw_text(frame, sx + 30, sy + 42, "YES", COLORS["black"], COLORS["fg"])
        draw_text(frame, sx + 88, sy + 42, "NO", COLORS["fg"])


def draw_app(scene):
    frame = blank_frame()
    rect(frame, 0, 0, WIDTH, HEIGHT, COLORS["bg"])
    rect(frame, 0, 0, WIDTH, 28, COLORS["bar"])
    draw_text(frame, 18, 9, "NTEE R1QUEST", COLORS["green"])
    draw_text(frame, 18, 42, ">_ NTEE R1QUEST", COLORS["fg"])
    draw_text(frame, 18, 62, "VER: 0.3.0", COLORS["green"])
    draw_text(frame, 18, 82, "TIME SPEND 183 MS,", COLORS["dim"])

    left_x = 18
    pane_y = 104
    left_w = 142
    right_x = 176
    right_w = 426
    pane_h = 172
    draw_box(frame, left_x, pane_y, left_w, pane_h, "COLLECTIONS")
    draw_box(frame, right_x, pane_y, right_w, pane_h, "RESULT")
    draw_rows(frame, left_x + 10, pane_y + 18, scene["collections"], 10)
    draw_rows(frame, right_x + 10, pane_y + 18, scene["result"], 32)

    rect(frame, 0, HEIGHT - 28, WIDTH, 28, COLORS["bar"])
    draw_text(frame, 18, HEIGHT - 20, scene["prompt"], COLORS["green"])

    if scene.get("modal"):
        draw_modal(frame, scene["modal"])

    return frame


def lzw_image_data(pixels):
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

    for pixel in pixels:
        write_code(clear)
        write_code(pixel)

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


def write_gif(path, frames, delay=90):
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


SCENES = [
    {
        "collections": [
            ("  EXAMPLE.NTS", COLORS["black"], COLORS["yellow"]),
            "  EXAMPLE-UP",
            "> FOLDER-1",
            "> FOLDER-2",
        ],
        "result": [
            "READY.",
            "SELECT A REQUEST FROM COLLECTIONS.",
            "",
            "ARROWS SCROLL RESULT.",
            "@S SEARCHES RESPONSE TEXT.",
        ],
        "prompt": "@QUERY >EXAMPLE_",
    },
    {
        "collections": [
            ("  EXAMPLE.NTS", COLORS["black"], COLORS["yellow"]),
            "  EXAMPLE-UP",
            "> FOLDER-1",
            "> FOLDER-2",
        ],
        "result": [
            "RESPONSE OF GET /TODOS/1",
            ("200 OK", COLORS["green"], None),
            "",
            "HEADERS",
            "CONTENT-TYPE: APPLICATION/JSON",
            "",
            "BODY",
            '{ "USERID": 1, "ID": 1 }',
        ],
        "prompt": "@QUERY >@S_",
    },
    {
        "collections": [
            "  EXAMPLE.NTS",
            "  EXAMPLE-UP",
            ("V FOLDER-1", COLORS["black"], COLORS["yellow"]),
            "    GET-POST.NTS",
            "> FOLDER-2",
        ],
        "result": [
            "RESPONSE OF GET /TODOS/1",
            "200 OK",
            "",
            "HEADERS",
            ("CONTENT-TYPE: APPLICATION/JSON", COLORS["black"], COLORS["yellow"]),
            "",
            "BODY",
            '{ "TITLE": "DELECTUS AUT AUTEM" }',
        ],
        "prompt": "@SEARCH >CONTENT-TYPE_",
    },
    {
        "collections": [
            "  EXAMPLE.NTS",
            "  EXAMPLE-UP",
            ("V FOLDER-1", COLORS["black"], COLORS["yellow"]),
            "    GET-POST.NTS",
            "> FOLDER-2",
        ],
        "result": [
            "VIEW MODE OPENS REQUEST FILES.",
            "ESC CLOSES THE MODAL.",
            "@EDIT ENABLES EDITING.",
        ],
        "prompt": "@VIEW >FOLDER-1/GET-POST_",
        "modal": {
            "title": "GET-POST.NTS",
            "lines": [
                ("1 | REF ../../DATA/EXAMPLE.NTD", COLORS["fg"], None),
                ("2 |", COLORS["dim"], None),
                ("3 | URL \"@I(HOST)/POSTS/1\"", COLORS["yellow"], None),
                ("4 | TYPE GET", COLORS["cyan"], None),
                ("5 |", COLORS["dim"], None),
                ("6 | HEADER ACCEPT, @I(CONTENT)", COLORS["fg"], None),
            ],
        },
    },
    {
        "collections": [
            "  EXAMPLE.NTS",
            "  EXAMPLE-UP",
            ("V FOLDER-1", COLORS["black"], COLORS["yellow"]),
            "    GET-POST.NTS",
            "> FOLDER-2",
        ],
        "result": [
            "EDIT MODE KEEPS A COPY UNTIL SAVE.",
            "INPUT IS BUFFERED AT CURSOR.",
            "ENTER APPLIES REPLACEMENT.",
        ],
        "prompt": "@EDIT >POSTS_",
        "modal": {
            "title": "GET-POST.NTS (EDITING)",
            "lines": [
                ("1 | REF ../../DATA/EXAMPLE.NTD", COLORS["fg"], None),
                ("2 |", COLORS["dim"], None),
                ("3 | URL \"@I(HOST)/POSTS/1\"", COLORS["yellow"], None),
                ("4 | TYPE GET", COLORS["cyan"], None),
                ("5 |", COLORS["dim"], None),
                ("6 | HEADER ACCEPT, @I(CONTENT)", COLORS["fg"], None),
            ],
            "save": True,
        },
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
