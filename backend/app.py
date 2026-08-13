from pathlib import Path
import io
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from PIL import Image
from backend.analyzer import analyze_image
from backend.router import choose_pipeline
from backend.pipelines import run_pipeline

app = FastAPI(title='Image Upscale Lab', version='0.2.0')
STATIC = Path(__file__).parent / 'static'
app.mount('/static', StaticFiles(directory=STATIC), name='static')

@app.get('/')
def index():
    return FileResponse(STATIC / 'index.html')

@app.get('/health')
def health():
    return {'status': 'ok'}

@app.post('/analyze')
async def analyze(file: UploadFile = File(...)):
    data = await file.read()
    try:
        image = Image.open(io.BytesIO(data)).convert('RGB')
    except Exception as exc:
        raise HTTPException(400, 'Unsupported or invalid image') from exc
    return analyze_image(image)

@app.post('/enhance')
async def enhance(file: UploadFile = File(...), mode: str = 'auto', scale: int = 4, fidelity: float = 0.75):
    if scale not in (2, 4, 8):
        raise HTTPException(400, 'scale must be 2, 4, or 8')
    data = await file.read()
    try:
        image = Image.open(io.BytesIO(data)).convert('RGB')
    except Exception as exc:
        raise HTTPException(400, 'Unsupported or invalid image') from exc
    analysis = analyze_image(image)
    pipeline = choose_pipeline(analysis, mode=mode)
    result = run_pipeline(image, pipeline, scale=scale, fidelity=fidelity)
    output = io.BytesIO()
    result.save(output, format='PNG')
    return Response(content=output.getvalue(), media_type='image/png', headers={'X-Pipeline': pipeline.name, 'X-Analyzer': str(analysis['image_type'])})
