import os
import io
import json
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.responses import Response, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from backend.analyzer import analyze_image
from backend.router import choose_pipeline
from backend.pipelines import run_pipeline
from backend.quality import score_candidate
from backend.model_registry import capabilities

app = FastAPI(title='Image Upscale Lab', version='0.5.0')
STATIC = Path(__file__).parent / 'static'
app.mount('/static', StaticFiles(directory=STATIC), name='static')

# --- Security constants ---
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
MAX_DECODE_PIXELS = 50_000_000       # 50 MP safety cap
ALLOWED_MIMES = {'image/jpeg', 'image/png', 'image/webp', 'image/tiff'}
ALLOWED_FORMATS = {'jpeg', 'png', 'webp', 'tiff'}

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['GET', 'POST'],
    allow_headers=['*'],
)


def _validate_and_decode(data: bytes, declared_mime: Optional[str] = None) -> Image.Image:
    """Validate upload size, MIME type, pixel-bomb safety, then decode."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f'File too large (max {MAX_UPLOAD_BYTES // (1024*1024)} MB)')

    if declared_mime and declared_mime not in ALLOWED_MIMES:
        raise HTTPException(415, f'Unsupported file type: {declared_mime}. Allowed: {", ".join(sorted(ALLOWED_MIMES))}')

    Image.MAX_IMAGE_PIXELS = None  # disable PIL's internal check; we do our own

    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except UnidentifiedImageError:
        raise HTTPException(400, 'File is not a recognized image')
    except Exception as exc:
        raise HTTPException(400, f'Failed to decode image: {str(exc)}') from exc

    # Verify detected format
    if image.format and image.format.lower() not in ALLOWED_FORMATS:
        raise HTTPException(415, f'Detected format "{image.format}" is not supported')

    # Explicit pixel-count check (more reliable than PIL's threshold)
    pixels = image.width * image.height
    if pixels > MAX_DECODE_PIXELS:
        raise HTTPException(400, f'Image too large: {pixels:,} pixels (max {MAX_DECODE_PIXELS:,})')

    return image.convert('RGB')


def _strip_metadata(img: Image.Image) -> Image.Image:
    """Return a copy with EXIF/metadata stripped."""
    data = list(img.getdata())
    clean = Image.new(img.mode, img.size)
    clean.putdata(data)
    return clean


@app.get('/')
def index():
    return FileResponse(STATIC / 'index.html')


@app.get('/health')
def health():
    return {'status': 'ok', 'version': app.version}


@app.get('/capabilities')
def get_capabilities():
    return capabilities()


@app.post('/analyze')
async def analyze(file: UploadFile = File(...)):
    data = await file.read()
    image = _validate_and_decode(data, file.content_type)
    return analyze_image(image)


@app.post('/enhance')
async def enhance(
    file: UploadFile = File(...),
    mode: str = 'auto',
    scale: int = Query(4, ge=2, le=8),
    fidelity: float = Query(0.75, ge=0.0, le=1.0),
    strip_metadata: bool = Query(True, ge=False),
    evaluate: bool = Query(False, ge=False),
):
    data = await file.read()
    image = _validate_and_decode(data, file.content_type)
    analysis = analyze_image(image)
    pipeline = choose_pipeline(analysis, mode=mode)
    result = run_pipeline(image, pipeline, scale=scale, fidelity=fidelity)

    quality_scores = None
    if evaluate:
        quality_scores = score_candidate(image, result)

    if strip_metadata:
        result = _strip_metadata(result)

    output = io.BytesIO()
    result.save(output, format='PNG')
    output.seek(0)

    headers = {
        'X-Pipeline': pipeline.name,
        'X-Analyzer': str(analysis['image_type']),
        'X-Scale': str(scale),
        'X-Fidelity': str(fidelity),
        'X-Original-Size': f'{image.width}x{image.height}',
        'X-Enhanced-Size': f'{result.width}x{result.height}',
    }
    if quality_scores:
        headers['X-Quality-Scores'] = json.dumps(quality_scores)

    return Response(
        content=output.getvalue(),
        media_type='image/png',
        headers=headers,
    )


@app.post('/quality')
async def quality(
    original: UploadFile = File(...),
    enhanced: UploadFile = File(...),
):
    """Evaluate quality of an enhanced image against its source."""
    orig_data = await original.read()
    enh_data = await enhanced.read()
    orig_img = _validate_and_decode(orig_data, original.content_type)
    enh_img = _validate_and_decode(enh_data, enhanced.content_type)
    return score_candidate(orig_img, enh_img)


@app.get('/security')
def security_info():
    return {
        'max_upload_mb': MAX_UPLOAD_BYTES // (1024 * 1024),
        'max_decode_pixels': MAX_DECODE_PIXELS,
        'allowed_formats': sorted(ALLOWED_MIMES),
        'metadata_stripped_by_default': True,
    }
