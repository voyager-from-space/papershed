#!/usr/bin/env python3
"""Writes a small PDF 1.5 whose Info dictionary and catalog sit inside a compressed object stream, with a
Flate-compressed XMP packet and a compressed cross-reference stream. This is what pdfTeX, Word and many
exporters produce. Built by hand with zlib so the tests do not depend on the library under test.
Every name below is invented. Usage: make-pdf-fixture.py out.pdf [marker]"""
import sys, zlib, struct

XMP = """<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
<dc:creator><rdf:Seq><rdf:li>@@ Author Name</rdf:li></rdf:Seq></dc:creator><dc:title><rdf:Alt><rdf:li xml:lang="x-default">@@ Title</rdf:li></rdf:Alt></dc:title>
<pdf:Producer>@@ Producer</pdf:Producer><xmp:CreatorTool>@@ Creator Tool</xmp:CreatorTool></rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>"""


def build(M="PLANTED-PDFMETA"):
    xmp = XMP.replace("@@", M).encode("utf-8")
    content = zlib.compress(b"0.2 0.4 0.8 rg 20 20 160 80 re f 1 1 1 rg 40 40 120 40 re f")
    objs = {  # objects that go inside the object stream
        1: b"<</Type/Catalog/Pages 2 0 R/Metadata 5 0 R>>",
        2: b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        3: b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 120]/Contents 4 0 R/Resources<<>>>>",
        6: f"<</Author({M} Author Name)/Creator({M} Creator)/Producer({M} Producer)/Title({M} Title)/Subject({M} Subject)/Keywords({M} keywords)/CreationDate(D:20260101000000Z)>>".encode(),
    }
    order = [1, 2, 3, 6]
    body = b""
    offs = []
    for n in order:
        offs.append((n, len(body)))
        body += objs[n] + b" "
    head = " ".join(f"{n} {o}" for n, o in offs).encode() + b" "
    objstm = zlib.compress(head + body)
    pdf = bytearray(b"%PDF-1.5\n%\xe2\xe3\xcf\xd3\n")
    pos = {}

    def add(n, d, stream):
        pos[n] = len(pdf)
        pdf.extend(f"{n} 0 obj\n".encode() + d + b"\nstream\n" + stream + b"\nendstream\nendobj\n")

    add(4, f"<</Length {len(content)}/Filter/FlateDecode>>".encode(), content)
    xz = zlib.compress(xmp)
    add(5, f"<</Type/Metadata/Subtype/XML/Length {len(xz)}/Filter/FlateDecode>>".encode(), xz)
    add(7, f"<</Type/ObjStm/N {len(order)}/First {len(head)}/Length {len(objstm)}/Filter/FlateDecode>>".encode(), objstm)
    xr_pos = len(pdf)
    rows = [(0, 0, 65535)]
    for n in range(1, 9):
        if n in order:
            rows.append((2, 7, order.index(n)))
        elif n == 8:
            rows.append((1, xr_pos, 0))
        else:
            rows.append((1, pos[n], 0))
    xz2 = zlib.compress(b"".join(struct.pack(">BIH", *r) for r in rows))
    pdf.extend(f"8 0 obj\n<</Type/XRef/Size 9/W[1 4 2]/Root 1 0 R/Info 6 0 R/ID[<00112233445566778899aabbccddeeff><00112233445566778899aabbccddeeff>]/Length {len(xz2)}/Filter/FlateDecode>>\nstream\n".encode() + xz2 + b"\nendstream\nendobj\n")
    pdf.extend(f"startxref\n{xr_pos}\n%%EOF\n".encode())
    return bytes(pdf)


if __name__ == "__main__":
    data = build(sys.argv[2] if len(sys.argv) > 2 else "PLANTED-PDFMETA")
    open(sys.argv[1], "wb").write(data)
    print(sys.argv[1], len(data), "bytes")
