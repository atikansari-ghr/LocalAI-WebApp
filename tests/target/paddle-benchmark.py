"""Offline CPU benchmark; its filename must not shadow the paddleocr package."""
import gc,hashlib,json,math,os,platform,time
from pathlib import Path
from importlib.metadata import version

assert os.name=='posix' and os.getuid()!=0 and os.environ.get('TARGET_TEST_LXC')=='disposable'
base=Path('/opt/localai/ocr/candidates/paddleocr-3.7.0')
expected_revisions={'PP-OCRv5_mobile_det':'0d63e78e2b680928f6b1747d76a08db6e645efb7','en_PP-OCRv5_mobile_rec':'267c36e24c331595590fe7bd72bde2436fd286f2','arabic_PP-OCRv5_mobile_rec':'33d91636a65dca87f5562cc48860332ae367ee1b'}
manifest=json.loads((base/'paddle-models.json').read_text())
assert len(manifest['models'])==3
for model in manifest['models']:
    name=model['repository'].removeprefix('PaddlePaddle/')
    assert name in expected_revisions and model['revision']==expected_revisions[name]
    assert model['license']=='Apache-2.0' and len(model['files'])==5
    for file in model['files']:
        assert file['filename'] in ['README.md','config.json','inference.json','inference.pdiparams','inference.yml']
        data=(base/'models'/name/file['filename']).read_bytes()
        assert len(data)==file['bytes'] and hashlib.sha256(data).hexdigest()==file['sha256']
assert version('paddleocr')=='3.7.0' and version('paddlepaddle')=='3.3.1' and version('paddlex')=='3.7.2'
from paddleocr import PaddleOCR
import paddle
assert paddle.device.get_device()=='cpu'
hashes={'english':'8a936d1ec24cc4c888cd3841498ee8f2790081cdab78d9210ca282e8916885cd','arabic':'b65d42a93ee4b50c2dadfe9f970a62ad583145a9e63914fdf5d3b5cb7fae735e'}
results=[]
for sample,model_name,expected in [('english','en_PP-OCRv5_mobile_rec','LOCAL AI TEST 1234'),('arabic','arabic_PP-OCRv5_mobile_rec','مرحبا بالعالم')]:
    image=base/'fixtures'/(sample+'.png')
    assert hashlib.sha256(image.read_bytes()).hexdigest()==hashes[sample]
    started=time.monotonic()
    try:
        engine=PaddleOCR(text_detection_model_name='PP-OCRv5_mobile_det',text_detection_model_dir=str(base/'models'/'PP-OCRv5_mobile_det'),text_recognition_model_name=model_name,text_recognition_model_dir=str(base/'models'/model_name),use_doc_orientation_classify=False,use_doc_unwarping=False,use_textline_orientation=False,device='cpu',cpu_threads=1,enable_mkldnn=False,text_recognition_batch_size=1)
        pages=list(engine.predict(str(image)))
        assert len(pages)==1
        page=pages[0];texts=page['rec_texts'];scores=page['rec_scores'];polygons=page['rec_polys']
        assert len(texts)==len(scores)==len(polygons) and len(texts)>0
        for score,polygon in zip(scores,polygons):
            assert math.isfinite(float(score)) and 0<=float(score)<=1 and len(polygon)==4
            for x,y in polygon:
                assert math.isfinite(float(x)) and math.isfinite(float(y)) and 0<=x<=900 and 0<=y<=140
        text=' '.join(texts)
        results.append(dict(language=sample,elapsedMs=round((time.monotonic()-started)*1000),syntheticText=text,expected=expected,exactTextPassed=text==expected,manualReviewRequired=text!=expected,coordinateProvenance=True))
        del pages,page,engine
        gc.collect()
    except Exception as error:
        results.append(dict(language=sample,elapsedMs=round((time.monotonic()-started)*1000),exactTextPassed=False,error=type(error).__name__,detail=str(error)[:2000]))
print(json.dumps(dict(scope='isolated-ocr-candidate',engine='PaddleOCR',version='3.7.0',framework='3.3.1',python=platform.python_version(),cpuOnly=True,actuallyTested=['en','ar'],results=results,activated=False,fullOcrGate='blocked'),ensure_ascii=False))
assert all(result['exactTextPassed'] for result in results),'Strict native PaddleOCR benchmark failed; preserve the failed gate'
