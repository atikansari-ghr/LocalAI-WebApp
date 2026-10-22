"""Only synthetic fixture generation; xlwt is never a production parser."""
import sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'.localai'/'fixture-python'))
import xlwt
book=xlwt.Workbook(encoding='utf-8')
first=book.add_sheet('Data');first.write(0,0,'LOCAL AI');first.write(0,1,'مرحبا بالعالم');first.write(1,0,42);first.write(1,1,'=inert text')
second=book.add_sheet('Second');second.write(0,0,'Second sheet');second.write(0,1,'مرحبا')
book.save(str(root/'tests'/'fixtures'/'documents'/'legacy.xls'))
rtf=r'{\rtf1\ansi\ansicpg1252\uc1 LOCAL AI TEST 1234\par \u1605?\u1585?\u1581?\u1576?\u1575? \u1576?\u1575?\u1604?\u1593?\u1575?\u1604?\u1605?\par}'
(root/'tests'/'fixtures'/'documents'/'multilingual.rtf').write_text(rtf,encoding='ascii')
