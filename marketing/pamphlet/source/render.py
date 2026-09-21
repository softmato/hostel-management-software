"""Render the pamphlet.

One master per side: A4 + 3 mm bleed at 600 dpi. The A4 PNGs (300 dpi) are cut
from that same master, and build_pdf.mjs embeds it losslessly — so the PNG and
the PDF are the same pixels by construction.

    python render.py outside inside   # then: node build_pdf.mjs
"""
import subprocess, sys, os, tempfile, shutil
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
DPI = 600
PX_PER_MM = DPI / 25.4                      # 23.622 device px per mm
DSF = DPI / 96                              # 6.25 device px per CSS px
BLEED, W, H = 3, 297, 210                   # mm
MW, MH = round((W + 2 * BLEED) * PX_PER_MM), round((H + 2 * BLEED) * PX_PER_MM)

# One 7157x5102 screenshot is more than headless Chrome will produce, so shoot
# 2x2 overlapping tiles. Offsets are multiples of 4 CSS px = 25 device px, so
# every tile lands on whole device pixels and the seams are exact.
TILE_CSS, STEP_CSS = (576, 412), (572, 408)

def shoot(name, x, y, out):
    url = "file:///" + os.path.join(HERE, f"{name}.html").replace("\\", "/") + f"#bleed&tile={x},{y}"
    for _ in range(3):                      # headless Chrome occasionally stalls; a fresh profile + retry clears it
        profile = tempfile.mkdtemp(prefix="pamphlet-chrome-")
        proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={profile}",
                                 f"--force-device-scale-factor={DSF}", f"--window-size={TILE_CSS[0]},{TILE_CSS[1]}",
                                 "--virtual-time-budget=20000", "--run-all-compositor-stages-before-draw",
                                 f"--screenshot={out}", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            ok = proc.wait(timeout=90) == 0
        except subprocess.TimeoutExpired:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)  # whole tree
            ok = False
        shutil.rmtree(profile, ignore_errors=True)
        if ok:
            return Image.open(out).convert("RGB")
        print(f"  retry {name} tile {x},{y}")
    raise RuntimeError(f"{name} tile {x},{y} failed 3 times")

for name in sys.argv[1:]:
    master = Image.new("RGB", (MW, MH), "white")
    for r in range(2):
        for c in range(2):
            x, y = c * STEP_CSS[0], r * STEP_CSS[1]
            tile = shoot(name, x, y, os.path.join(HERE, f"_{name}_t{r}{c}.png"))
            master.paste(tile, (round(x * DSF), round(y * DSF)))
    master.save(os.path.join(HERE, f"{name}_master600.png"), dpi=(DPI, DPI))
    b = BLEED * PX_PER_MM                   # trim box, fractional px — resize() takes a float box
    a4 = master.resize((3508, 2480), Image.LANCZOS, box=(b, b, b + W * PX_PER_MM, b + H * PX_PER_MM))
    a4.save(os.path.join(HERE, f"{name}.png"), dpi=(300, 300), optimize=True)
    a4.resize((1600, round(1600 * 2480 / 3508)), Image.LANCZOS).save(os.path.join(HERE, f"prev_{name}.png"))
    print(name, "master", master.size, "a4", a4.size)
