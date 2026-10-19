"""Generate synthetic JPEG/WebP/TIFF/orientation fixtures from checked-in OCR PNGs."""
from pathlib import Path
from PIL import Image
import struct,zlib
root=Path(__file__).resolve().parents[1]/'tests'/'fixtures'/'documents'
with Image.open(root/'english.png') as image:
 image.convert('RGB').save(root/'english.jpg',quality=95)
 image.convert('RGB').save(root/'english.webp',lossless=True)
 exif=Image.Exif();exif[274]=6;image.convert('RGB').save(root/'oriented.jpg',quality=95,exif=exif)
 with Image.open(root/'arabic.png') as arabic:image.convert('RGB').save(root/'two-pages.tiff',save_all=True,append_images=[arabic.convert('RGB')],compression='tiff_deflate')
raw=bytearray((root/'english.png').read_bytes());raw[16:24]=struct.pack('>II',100000,100000);raw[29:33]=struct.pack('>I',zlib.crc32(raw[12:29])&0xffffffff);(root/'oversized.png').write_bytes(raw)
(root/'corrupt.png').write_bytes((root/'english.png').read_bytes()[:48])
with Image.open(root/'english.png') as english, Image.open(root/'arabic.png') as arabic:
 english.convert('RGB').save(root/'oriented.tiff',save_all=True,append_images=[arabic.convert('RGB')],compression='tiff_deflate',tiffinfo={274:6})
raw=bytearray((root/'oriented.tiff').read_bytes());order='<' if raw[:2]==b'II' else '>';offset=struct.unpack_from(order+'I',raw,4)[0];frame=0
while offset:
 count=struct.unpack_from(order+'H',raw,offset)[0]
 for index in range(count):
  at=offset+2+index*12;tag,kind,size=struct.unpack_from(order+'HHI',raw,at)
  if tag==274:
   assert kind==3 and size==1
   struct.pack_into(order+'H',raw,at+8,6 if frame==0 else 8)
 offset=struct.unpack_from(order+'I',raw,offset+2+count*12)[0];frame+=1
assert frame==2
(root/'oriented.tiff').write_bytes(raw)
with Image.open(root/'english.png') as image:image.resize((3600,560)).save(root/'large.png')
image=Image.new('RGBA',(100,40),(0,0,0,0));image.putpixel((50,20),(0,0,0,255));image.save(root/'transparent.png')
