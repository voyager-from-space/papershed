#!/usr/bin/env python3
"""Builds the extra zips the verify script uploads, into test/out/ (not committed; the big one is 52 MB).
oversize.zip     one figure file bigger than arXiv's 50 MB limit
bigimage.zip     a 36-megapixel PNG (arXiv warns above 34)
break-clean.zip  builds as given, but reads a data file by raw \\openin, which papershed cannot see as a reference
broken.zip       fails to build before and after cleaning
Everything is invented."""
import io, os, random, zipfile
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "..", "test", "out")
os.makedirs(OUT, exist_ok=True)
DATE = (2026, 1, 1, 0, 0, 0)


def write(name, files, stored=False):
    with zipfile.ZipFile(os.path.join(OUT, name), "w", zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED) as z:
        for n, d in files:
            zi = zipfile.ZipInfo(n, DATE)
            zi.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
            z.writestr(zi, d)
    print(name, os.path.getsize(os.path.join(OUT, name)))


def tex(body, pre=""):
    return ("\\documentclass{article}\n" + pre + "\\begin{document}\n" + body + "\n\\end{document}\n").encode()


rng = random.Random(3)
write("oversize.zip", [("main.tex", tex("Big figure.\n\\includegraphics{figures/huge}", "\\usepackage{graphicx}\n")), ("figures/huge.pdf", rng.randbytes(52_000_000))], stored=True)
b = io.BytesIO()
Image.new("RGB", (6000, 6000), (30, 90, 160)).save(b, "PNG")
write("bigimage.zip", [("main.tex", tex("\\includegraphics[width=3cm]{figures/wide}", "\\usepackage{graphicx}\n")), ("figures/wide.png", b.getvalue())])
write("break-clean.zip", [("main.tex", tex("\\openin5=numbers.dat\n\\ifeof5 \\errmessage{numbers.dat is missing}\\else\\read5 to \\line Value: \\line\\fi")), ("numbers.dat", b"42\n")])
write("broken.zip", [("main.tex", tex("This line is fine. \\thiscommanddoesnotexist{x}"))])
