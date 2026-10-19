"""Private offline CPU worker; outer systemd boundary and admission are mandatory."""
import contextlib,hashlib,json,os,sys
from pathlib import Path
from importlib.metadata import version
base,image,language=Path(sys.argv[1]),Path(sys.argv[2]),sys.argv[3]
assert len(sys.argv)==4 and language in ['en','ar'] and os.getuid()!=0
assert version('paddleocr')=='3.7.0' and version('paddlepaddle')=='3.3.1' and version('paddlex')=='3.7.2'
manifest=json.loads((base/'paddle-models.json').read_text())
for model in manifest['models']:
    name=model['repository'].removeprefix('PaddlePaddle/')
    assert name in ['PP-OCRv5_mobile_det','en_PP-OCRv5_mobile_rec','arabic_PP-OCRv5_mobile_rec']
    for item in model['files']:
        data=(base/'models'/name/item['filename']).read_bytes()
        assert len(data)==item['bytes'] and hashlib.sha256(data).hexdigest()==item['sha256']
with contextlib.redirect_stdout(sys.stderr):
    from paddleocr import PaddleOCR
    from PIL import Image
    import paddle
    assert paddle.device.get_device()=='cpu'
    with Image.open(image) as picture:
        width,height=picture.size
        assert picture.format=='PNG' and 0<width<=2000 and 0<height<=2000
    model='en_PP-OCRv5_mobile_rec' if language=='en' else 'arabic_PP-OCRv5_mobile_rec'
    engine=PaddleOCR(text_detection_model_name='PP-OCRv5_mobile_det',text_detection_model_dir=str(base/'models'/'PP-OCRv5_mobile_det'),text_recognition_model_name=model,text_recognition_model_dir=str(base/'models'/model),use_doc_orientation_classify=False,use_doc_unwarping=False,use_textline_orientation=False,device='cpu',cpu_threads=1,enable_mkldnn=False,text_recognition_batch_size=1)
    pages=list(engine.predict(str(image)))
    assert len(pages)==1
    page=pages[0]
    assert len(page['rec_texts'])==len(page['rec_scores'])==len(page['rec_polys'])<=1000
    lines=[dict(text=text,confidence=float(score),box=[dict(x=float(x),y=float(y)) for x,y in polygon]) for text,score,polygon in zip(page['rec_texts'],page['rec_scores'],page['rec_polys'])]
print(json.dumps(dict(engine='paddleocr',width=width,height=height,lines=lines),ensure_ascii=False,allow_nan=False))
