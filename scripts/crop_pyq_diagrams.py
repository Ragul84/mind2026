import os
import re
import sys
import tempfile
import subprocess
from PIL import Image

GS_BIN = r"C:\Program Files\gs\gs10.07.1\bin\gswin64c.exe"
TESS_BIN = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
PUBLIC_DIAGRAMS_DIR = r"C:\mindwhite\public\pyq-diagrams"

os.makedirs(PUBLIC_DIAGRAMS_DIR, exist_ok=True)

def render_pdf_page_to_png(pdf_path, page_num, output_png_path, dpi=300):
    """Renders a single 1-based page of a PDF file to PNG using Ghostscript."""
    cmd = [
        GS_BIN,
        "-q",
        "-dNOPAUSE",
        "-dBATCH",
        "-sDEVICE=png16m",
        f"-dFirstPage={page_num}",
        f"-dLastPage={page_num}",
        f"-r{dpi}",
        f"-sOutputFile={output_png_path}",
        pdf_path
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def crop_diagram_from_page(png_path, output_crop_path, crop_box_pct=(0.1, 0.2, 0.9, 0.8)):
    """Crops a region from page PNG specified in percentages (left, top, right, bottom)."""
    with Image.open(png_path) as img:
        w, h = img.size
        left = int(w * crop_box_pct[0])
        top = int(h * crop_box_pct[1])
        right = int(w * crop_box_pct[2])
        bottom = int(h * crop_box_pct[3])
        cropped = img.crop((left, top, right, bottom))
        cropped.save(output_crop_path, "PNG")
        print(f"Saved cropped diagram to: {output_crop_path}")

print("Python PIL & Ghostscript diagram crop module loaded successfully.")
