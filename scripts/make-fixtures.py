#!/usr/bin/env python3
"""Builds test/fixtures/sample-paper.zip (also the in-app sample at site/sample/).

Every secret, link, name and email here is invented and obviously fake.
AKIAIOSFODNN7EXAMPLE is the documented example key from AWS's own docs.
"""
import io, random, zipfile, os, shutil
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from PIL.TiffImagePlugin import IFDRational

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "test/fixtures/sample-paper.zip")
SITE = os.path.join(ROOT, "site/sample/sample-paper.zip")
rng = random.Random(7)

MAIN = r"""\documentclass[11pt]{article}
\usepackage{graphicx}
\usepackage{listings}
\usepackage{comment}
\usepackage{todonotes}
\usepackage{mystyle}
\graphicspath{{figures/}}
% TODO: answer reviewer 2 before the camera-ready
% password = hunter2-EXAMPLE (shared lab server login, remove!)
% aws key for the data bucket: AKIAIOSFODNN7EXAMPLE
\title{A sample paper}% PLANTED-JOIN-COMMENT
\author{A. N. Author}
\begin{document}
\maketitle
We cut the error by 12\% on the benchmark. % PLANTED-INLINE: the old number was 9\%
Raw data: \url{https://www.dropbox.com/s/fakeabc123/data.zip?dl=0}.
\input{sections/intro}
\begin{figure}\centering
\includegraphics[width=.8\linewidth]{field-site}% PLANTED-FIGURE-COMMENT
\caption{Field site.}
\end{figure}
\includegraphics[width=.5\linewidth]{pipeline.png}
\includegraphics[width=.5\linewidth]{plot}
\begin{lstlisting}
x = 5 % KEEP-LSTLISTING-PERCENT
\end{lstlisting}
\begin{verbatim}
progress: 50% KEEP-VERBATIM-PERCENT
\end{verbatim}
\begin{comment}
PLANTED-COMMENT-ENV: old abstract that claimed we beat everything.
\end{comment}
\iffalse
PLANTED-IFFALSE: dead section kept for later. \ifx\a\b nested \fi still dead.
\fi
After the dead block. \todo{tighten this paragraph}
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
"""

INTRO = r"""\section{Introduction}
% PLANTED-INTRO: draft at https://docs.google.com/document/d/1FAKEexampleDocId00000/edit
Our method builds on prior work~\cite{fake2024}.
Contact: first.author@example.com
"""

OLD = r"""\section{Old draft}
This section was cut. It mentions https://www.overleaf.com/project/0000fake0000example0000
"""

BIB = "@article{fake2024, title={A made-up paper}, author={Nobody, A.}, journal={J. Examples}, year={2024}}\n"
BBL = "\\begin{thebibliography}{1}\n\\bibitem{fake2024} A.~Nobody. A made-up paper. J. Examples, 2024.\n\\end{thebibliography}\n"
STY = "\\ProvidesPackage{mystyle}\n% PLANTED-STY-COMMENT stays: .sty files are not stripped\n\\newcommand{\\R}{\\mathbb{R}}\n"
NOTES = "deploy token for the figure bot: ghp_FAKEexampleTOKEN0000000000000000000000\n"


def noisy(w, h, base):
    # smooth gradient plus seeded noise: deterministic and photo-like enough to be large as JPEG
    img = Image.new("RGB", (w, h))
    grad = Image.linear_gradient("L").resize((w, h))
    noise = Image.frombytes("L", (w, h), rng.randbytes(w * h))
    img = Image.merge("RGB", (grad, noise, Image.new("L", (w, h), base)))
    return img


def jpeg_with_gps():
    img = noisy(2600, 1700, 120)
    exif = Image.Exif()
    exif[0x010F] = "FakeCam"
    exif[0x0110] = "Model 0"
    gps = exif.get_ifd(0x8825)
    gps[0] = b"\x02\x02\x00\x00"
    gps[1] = "N"
    gps[2] = (IFDRational(48), IFDRational(51), IFDRational(296, 10))
    gps[3] = "E"
    gps[4] = (IFDRational(2), IFDRational(17), IFDRational(402, 10))
    b = io.BytesIO()
    img.save(b, "JPEG", quality=92, exif=exif.tobytes())
    return b.getvalue()


def png_with_text():
    img = Image.new("RGB", (900, 600), (245, 245, 250))
    for y in range(100, 500, 40):
        img.paste((40, 60, 160), (100, 100 + (y - 100) // 2, 800, 104 + (y - 100) // 2))
    info = PngInfo()
    info.add_text("Author", "A. Fake Student")
    info.add_text("Software", "FakePlot 1.0")
    info.add_text("Comment", "exported from /home/fakeuser/thesis/figs")
    b = io.BytesIO()
    img.save(b, "PNG", pnginfo=info)
    return b.getvalue()


def plain_jpeg(w, h):
    b = io.BytesIO()
    noisy(w, h, 60).save(b, "JPEG", quality=80)
    return b.getvalue()


def plain_png(w, h):
    b = io.BytesIO()
    Image.new("RGB", (w, h), (200, 220, 200)).save(b, "PNG")
    return b.getvalue()


def pdf_with_info():
    content = b"0 0 1 rg 10 10 80 60 re f\n"
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R /Metadata 5 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 80] /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"endstream",
        None,
        b"<< /Author (A. Fake Student) /Creator (FakePlot 1.0 on fakeuser-laptop) /Producer (FakePDF 2.3) /Title (plot draft v7) >>",
    ]
    xmp = b'<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>A. Fake Student</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
    objs[4] = b"<< /Type /Metadata /Subtype /XML /Length %d >>\nstream\n" % len(xmp) + xmp + b"\nendstream"
    out = b"%PDF-1.4\n"
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    x = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for o in offs:
        out += b"%010d 00000 n \n" % o
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info 6 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
    return out


def main():
    P = "sample-paper/"
    files = [
        (P + "main.tex", MAIN.encode()),
        (P + "sections/intro.tex", INTRO.encode()),
        (P + "sections/old-draft.tex", OLD.encode()),
        (P + "mystyle.sty", STY.encode()),
        (P + "refs.bib", BIB.encode()),
        (P + "refs-old.bib", BIB.encode()),
        (P + "main.bbl", BBL.encode()),
        (P + "figures/field-site.jpg", jpeg_with_gps()),
        (P + "figures/pipeline.png", png_with_text()),
        (P + "figures/plot.pdf", pdf_with_info()),
        (P + "figures/unused-photo.jpg", plain_jpeg(1600, 1000)),
        (P + "figures/scratch.png", plain_png(400, 300)),
        (P + "notes.txt", NOTES.encode()),
        (P + "main.pdf", pdf_with_info()),
        (P + "main.aux", b"\\relax\n"),
        (P + "main.log", b"This is pdfTeX (fake log)\n"),
        (P + "main.out", b""),
        (P + "main.fls", b"PWD /fake\n"),
        (P + "main.fdb_latexmk", b"# fake\n"),
        (P + "main.synctex.gz", bytes(64)),
        (P + ".DS_Store", bytes(32)),
        ("__MACOSX/sample-paper/._main.tex", bytes(32)),
    ]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files:
            zi = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, data)
    os.makedirs(os.path.dirname(SITE), exist_ok=True)
    shutil.copy(OUT, SITE)
    print(OUT, os.path.getsize(OUT), "bytes,", len(files), "entries, uncompressed", sum(len(d) for _, d in files))


main()
