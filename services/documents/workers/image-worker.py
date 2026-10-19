"""Fixed, offline Pillow image normalization worker; run inside the native sandbox."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import warnings
from PIL import Image, ImageFile, ImageOps, __version__

MAX_FRAME_PIXELS = 20_000_000
MAX_TOTAL_PIXELS = 40_000_000
MAX_OUTPUT_BYTES = 20 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = MAX_FRAME_PIXELS
ImageFile.LOAD_TRUNCATED_IMAGES = False
warnings.simplefilter('error', Image.DecompressionBombWarning)
os.umask(0o077)

class ImageLimit(Exception):
    pass

class Output(io.BytesIO):
    def __init__(self, remaining):
        super().__init__()
        self.remaining = remaining
    def write(self, value):
        if self.tell() + len(value) > self.remaining:
            raise ImageLimit('image_output_limit')
        return super().write(value)

def main():
    if __version__ != '13.0.0' or len(sys.argv) != 4:
        raise ImageLimit('image_worker_version_mismatch')
    source, output, expected = sys.argv[1:]
    if expected not in {'PNG', 'JPEG', 'WEBP', 'TIFF'}:
        raise ImageLimit('image_format_mismatch')
    with Image.open(source, formats=[expected]) as image:
        if image.format != expected:
            raise ImageLimit('image_format_mismatch')
        image.verify()
    frames = []
    pixels = total_output = 0
    with Image.open(source, formats=[expected]) as image:
        count = getattr(image, 'n_frames', 1)
        if count < 1 or count > 100:
            raise ImageLimit('image_frame_limit')
        for index in range(count):
            image.seek(index)
            width, height = ((int(image.tag_v2[256]), int(image.tag_v2[257]))
                             if image.format == 'TIFF' else image.size)
            pixels += width * height
            if width < 1 or height < 1 or width * height > MAX_FRAME_PIXELS or pixels > MAX_TOTAL_PIXELS:
                raise ImageLimit('image_pixel_limit')
            orientation = image.getexif().get(274, 1)
            if orientation not in range(1, 9):
                raise ImageLimit('invalid_image')
            mode = image.mode
            image.load()
            normalized = ImageOps.exif_transpose(image)
            if 'A' in normalized.getbands() or 'transparency' in normalized.info:
                rgba = normalized.convert('RGBA')
                background = Image.new('RGBA', rgba.size, 'white')
                background.alpha_composite(rgba)
                normalized = background.convert('RGB')
            else:
                normalized = normalized.convert('RGB')
            normalized.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
            normalized.info.clear()
            encoded = Output(MAX_OUTPUT_BYTES - total_output)
            normalized.save(encoded, format='PNG')
            content = encoded.getvalue()
            total_output += len(content)
            name = Path(output) / f'page-{index + 1}.png'
            with name.open('xb') as target:
                target.write(content)
            frames.append({'page': index + 1, 'originalWidth': width, 'originalHeight': height,
                           'orientation': orientation, 'originalMode': mode,
                           'width': normalized.width, 'height': normalized.height,
                           'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
    print(json.dumps({'version': __version__, 'format': expected, 'frames': frames}))

try:
    main()
except (Image.DecompressionBombWarning, Image.DecompressionBombError):
    print(json.dumps({'error': 'image_pixel_limit'}))
    sys.exit(2)
except ImageLimit as error:
    print(json.dumps({'error': str(error)}))
    sys.exit(2)
except Exception:
    print(json.dumps({'error': 'invalid_image'}))
    sys.exit(2)
