"""Synthetic PDF fixtures (encryption uses randomized salts). No personal content or external assets."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter
root=Path(__file__).resolve().parents[1]
out=root/'tests'/'fixtures'/'documents'
target=out/'mixed-pages.pdf'
c=canvas.Canvas(str(target),pagesize=(612,792),invariant=1)
c.setAuthor('Atik Ansari');c.setCreator('Local AI synthetic fixtures');c.setTitle('Local AI synthetic mixed pages')
c.setFont('Helvetica',18);c.drawString(54,738,'LOCAL AI NATIVE TEXT 1234');c.showPage()
c.drawImage(ImageReader(str(out/'english.png')),54,590,width=504,height=78.4);c.showPage()
c.setFont('Helvetica',18);c.drawString(54,738,'LOCAL AI MIXED PAGE');c.drawImage(ImageReader(str(out/'arabic.png')),54,590,width=504,height=78.4);c.showPage();c.save()
writer=PdfWriter();writer.append(PdfReader(target));writer.add_metadata({'/Author':'Atik Ansari','/Title':'Local AI encrypted test fixture'});writer.encrypt('synthetic-fixture-password',algorithm='AES-256')
with (out/'encrypted.pdf').open('wb') as f:writer.write(f)
(out/'truncated.pdf').write_bytes(target.read_bytes()[:180])
for path in [target,out/'encrypted.pdf',out/'truncated.pdf']:print(path.name,path.stat().st_size)
