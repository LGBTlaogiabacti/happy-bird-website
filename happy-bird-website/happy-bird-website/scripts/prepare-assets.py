#!/usr/bin/env python3
"""Derives web-ready helper assets from the original sprites.
Originals in public/assets/sprites are never modified; outputs are NEW files.

Run:  python3 scripts/prepare-assets.py
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..", "public", "assets")
SP = os.path.join(ROOT, "sprites")
BG = os.path.join(ROOT, "backgrounds")
IM = os.path.join(ROOT, "images")
os.makedirs(BG, exist_ok=True)
os.makedirs(IM, exist_ok=True)


def load(name):
    return Image.open(os.path.join(SP, name)).convert("RGBA")


# 1. Bird sprite sheets: 4 frames (up, mid, down, mid) -> one strip per colour
for colour in ("yellow", "red", "blue"):
    frames = [load(f"{colour}bird-{k}.png") for k in ("upflap", "midflap", "downflap", "midflap")]
    w, h = frames[0].size
    sheet = Image.new("RGBA", (w * 4, h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * w, 0))
    sheet.save(os.path.join(SP, f"{colour}bird-sheet.png"))

# 2. Pixel clouds (hand-mapped pixel art)
CLOUDS = {
    "cloud-a": [
        "......WWWW..........",
        "....WWWWWWWW...WWW..",
        "...WWWWWWWWWWWWWWWW.",
        "..WWWWWWWWWWWWWWWWWW",
        ".WWWWWWWWWWWWWWWWWWW",
        "WWWWWWWWWWWWWWWWWWWW",
        "sWWWWWWWWWWWWWWWWWWs",
        ".ssssssssssssssssss.",
    ],
    "cloud-b": [
        "....WWW......",
        "..WWWWWWW.WW.",
        ".WWWWWWWWWWWW",
        "WWWWWWWWWWWWW",
        "sWWWWWWWWWWWs",
        ".sssssssssss.",
    ],
    "cloud-c": [
        ".....WW.....",
        "..WWWWWWWW..",
        ".WWWWWWWWWWW",
        "WWWWWWWWWWWW",
        "WWWWWWWWWWWW",
        ".ssssssssss.",
    ],
}
PAL = {"W": (255, 255, 255, 255), "s": (190, 226, 247, 255)}
for name, rows in CLOUDS.items():
    im = Image.new("RGBA", (len(rows[0]), len(rows)), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, c in enumerate(row):
            if c in PAL:
                im.putpixel((x, y), PAL[c])
    im.save(os.path.join(BG, f"{name}.png"))

# 3. Scenery strip cropped from the supplied day background (skyline + hedge)
day = load("background-day.png")
day.crop((0, 300, 288, 400)).save(os.path.join(BG, "skyline-day-strip.png"))
night = load("background-night.png")
night.crop((0, 300, 288, 400)).save(os.path.join(BG, "skyline-night-strip.png"))

# 4. Composed "world preview" scenes built ONLY from supplied sprites.
#    These are labelled as sprite compositions on the site (not gameplay screenshots).
SCALE = 2


def digits(score):
    imgs = [load(f"{d}.png") for d in str(score)]
    total = sum(i.width for i in imgs)
    out = Image.new("RGBA", (total, imgs[0].height), (0, 0, 0, 0))
    x = 0
    for i in imgs:
        out.paste(i, (x, 0))
        x += i.width
    return out


def scene(name, bg, pipe, bird, bird_pos, pipes, score=None, gameover=False):
    canvas = load(bg).copy()
    base = load("base.png")
    pp = load(pipe)
    pipe_up = pp
    pipe_down = pp.transpose(Image.FLIP_TOP_BOTTOM)
    for x, gap_y in pipes:
        gap = 100
        canvas.alpha_composite(pipe_down, (x, gap_y - gap // 2 - pipe_down.height))
        canvas.alpha_composite(pipe_up, (x, gap_y + gap // 2))
    canvas.alpha_composite(base, (0, 512 - 112))
    canvas.alpha_composite(base, (336 - 48, 512 - 112)) if False else None
    b = load(bird)
    canvas.alpha_composite(b, bird_pos)
    if score is not None:
        d = digits(score)
        canvas.alpha_composite(d, ((288 - d.width) // 2, 48))
    if gameover:
        go = load("gameover.png")
        canvas.alpha_composite(go, ((288 - go.width) // 2, 170))
    canvas = canvas.resize((288 * SCALE, 512 * SCALE), Image.NEAREST).convert("RGB")
    canvas.save(os.path.join(IM, f"{name}.webp"), "WEBP", quality=88, method=6)
    canvas.save(os.path.join(IM, f"{name}.png"), optimize=True)


scene("scene-day", "background-day.png", "pipe-green.png", "yellowbird-midflap.png", (60, 230),
      [(190, 250), (330, 200)], score=7)
scene("scene-night", "background-night.png", "pipe-green.png", "bluebird-upflap.png", (64, 200),
      [(180, 220), (320, 280)], score=23)
scene("scene-red-pipes", "background-day.png", "pipe-red.png", "redbird-downflap.png", (58, 270),
      [(200, 300), (340, 240)], score=12)
scene("scene-gameover", "background-night.png", "pipe-green.png", "yellowbird-downflap.png", (70, 380),
      [(210, 250)], score=None, gameover=True)
# Remove PNG duplicates we do not need (keep webp for the site)
for n in ("scene-day", "scene-night", "scene-red-pipes", "scene-gameover"):
    os.remove(os.path.join(IM, f"{n}.png"))

print("assets prepared")
