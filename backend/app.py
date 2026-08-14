import os
import io
import json
import time
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.responses import Response, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from backend.analyzer import analyze_image
from backend.router import choose_pipeline, route
from backend.pipelines import run_pipeline, PipelineResult, run_model_enhancement
from backend.quality import score_candidate
from backend.model_registry import capabilities, registry, torch_device

app = FastAPI(title="Image Upscale Lab", version="0.6.0")
STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_DECODE_PIXELS = 50_000_000
ALLOWED_MIMES = {"image/jpeg", "image/png", "image/webp", "image/tiff"}
ALLOWED_FORMATS = {"jpeg", "png", "webp", "tiff"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _validate_and_decode(data: bytes, declared_mime: Optional[str] = None) -> Image.Image:
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")
    if declared_mime and declared_mime not in ALLOWED_MIMES:
        raise HTTPException(415, f"Unsupported file type: {declared_mime}. Allowed: {', '.join(sorted(ALLOWED_MIMES))}")
    Image.MAX_IMAGE_PIXELS = None
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except UnidentifiedImageError:
        raise HTTPException(400, "File is not a recognized image")
    except Exception as exc:
        raise HTTPException(400, f"Failed to decode image: {str(exc)}") from exc
    if image.format and image.format.lower() not in ALLOWED_FORMATS:
        raise HTTPException(415, f'Detected format "{image.format}" is not supported')
    pixels = image.width * image.height
    if pixels > MAX_DECODE_PIXELS:
        raise HTTPException(400, f"Image too large: {pixels:,} pixels (max {MAX_DECODE_PIXELS:,})")
    return image.convert("RGB")


def _strip_metadata(img: Image.Image) -> Image.Image:
    data = list(img.getdata())
    clean = Image.new(img.mode, img.size)
    clean.putdata(data)
    return clean


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/health")
def health():
    return {"status": "ok", "version": app.version}


@app.get("/capabilities")
def get_capabilities():
    return capabilities()


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    data = await file.read()
    image = _validate_and_decode(data, file.content_type)
    return analyze_image(image)


@app.post("/route")
async def get_route(file: UploadFile = File(...), mode: str = "auto"):
    data = await file.read()
    image = _validate_and_decode(data, file.content_type)
    analysis = analyze_image(image)
    decision = route(analysis, mode=mode)
    return {
        "analysis": analysis,
        "recommended_model": decision.recommended_model,
        "confidence": decision.confidence,
        "reason": decision.reason,
        "detected_type": decision.detected_type,
        "alternatives": decision.alternatives,
    }


@app.post("/enhance")
async def enhance(
    file: UploadFile = File(...),
    mode: str = "auto",
    scale: int = Query(4, ge=2, le=8),
    fidelity: float = Query(0.75, ge=0.0, le=1.0),
    strip_metadata: bool = Query(True),
    evaluate: bool = Query(False),
):
    data = await file.read()
    image = _validate_and_decode(data, file.content_type)
    analysis = analyze_image(image)
    pipeline = choose_pipeline(analysis, mode=mode, scale=scale)
    result = run_pipeline(image, pipeline, scale=scale, fidelity=fidelity)

    quality_scores = None
    if evaluate:
        quality_scores = score_candidate(image, result.image)

    out_img = result.image
    if strip_metadata:
        out_img = _strip_metadata(out_img)

    output = io.BytesIO()
    out_img.save(output, format="PNG")
    output.seek(0)

    headers = {
        "X-Pipeline": result.pipeline,
        "X-Model": result.model_name,
        "X-Analyzer": str(analysis.get("image_type", "photo")),
        "X-Scale": str(result.scale),
        "X-Fidelity": str(fidelity),
        "X-Original-Size": f"{result.original_size[0]}x{result.original_size[1]}",
        "X-Enhanced-Size": f"{result.enhanced_size[0]}x{result.enhanced_size[1]}",
        "X-Runtime": str(result.runtime_sec),
        "X-Device": result.device,
        "X-Used-Fallback": str(result.used_fallback).lower(),
    }
    if result.fallback_reason:
        headers["X-Fallback-Reason"] = result.fallback_reason
    if quality_scores:
        headers["X-Quality-Scores"] = json.dumps(quality_scores)

    return Response(content=output.getvalue(), media_type="image/png", headers=headers)


@app.post("/enhance-model")
async def enhance_with_model(
    file: UploadFile = File(...),
    model_id: str = "realesrgan-x4plus",
    scale: int = Query(4, ge=2, le=8),
    fidelity: float = Query(0.0, ge=0.0, le=1.0),
    strip_metadata: bool = Query(True),
    evaluate: bool = Query(False),
):
    """Enhance with a specific model (not auto-routed). For candidate engine."""
    data = await file.read()
    image = _validate_and_decode(data, file.content_type)
    try:
        result = run_model_enhancement(image, model_id, scale=scale, fidelity=fidelity)
    except Exception as e:
        raise HTTPException(400, str(e))

    quality_scores = None
    if evaluate:
        quality_scores = score_candidate(image, result.image)

    out_img = result.image
    if strip_metadata:
        out_img = _strip_metadata(out_img)

    output = io.BytesIO()
    out_img.save(output, format="PNG")
    output.seek(0)

    headers = {
        "X-Model": result.model_name,
        "X-Scale": str(result.scale),
        "X-Original-Size": f"{result.original_size[0]}x{result.original_size[1]}",
        "X-Enhanced-Size": f"{result.enhanced_size[0]}x{result.enhanced_size[1]}",
        "X-Runtime": str(result.runtime_sec),
        "X-Device": result.device,
    }
    if quality_scores:
        headers["X-Quality-Scores"] = json.dumps(quality_scores)

    return Response(content=output.getvalue(), media_type="image/png", headers=headers)


@app.post("/quality")
async def quality(
    original: UploadFile = File(...),
    enhanced: UploadFile = File(...),
):
    orig_data = await original.read()
    enh_data = await enhanced.read()
    orig_img = _validate_and_decode(orig_data, original.content_type)
    enh_img = _validate_and_decode(enh_data, enhanced.content_type)
    return score_candidate(orig_img, enh_img)


@app.get("/security")
def security_info():
    return {
        "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
        "max_decode_pixels": MAX_DECODE_PIXELS,
        "allowed_formats": sorted(ALLOWED_MIMES),
        "metadata_stripped_by_default": True,
    }


@app.post("/candidates")
async def run_candidates(
    file: UploadFile = File(...),
    scale: int = Query(4, ge=2, le=8),
    fidelity: float = Query(0.0, ge=0.0, le=1.0),
    evaluate: bool = Query(True),
):
    """Run multiple available models and return ranked candidates."""
    from backend.model_adapter import ModelStatus

    data = await file.read()
    image = _validate_and_decode(data, file.content_type)
    analysis = analyze_image(image)

    all_models = registry.list_models()
    compatible = [m for m in all_models if m.status == ModelStatus.AVAILABLE and scale in m.supported_scales]

    if not compatible:
        raise HTTPException(400, "No models available for the requested scale")

    candidates = []
    for model_info in compatible:
        try:
            result = run_model_enhancement(image, model_info.id, scale=scale, fidelity=fidelity)
            quality = score_candidate(image, result.image) if evaluate else None
            buf = io.BytesIO()
            result.image.save(buf, format="PNG")
            buf.seek(0)
            import base64
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            candidates.append({
                "model_id": model_info.id,
                "model_name": model_info.name,
                "runtime_sec": result.runtime_sec,
                "enhanced_size": f"{result.enhanced_size[0]}x{result.enhanced_size[1]}",
                "quality": quality,
                "image_b64": b64[:500] + "..." if len(b64) > 500 else b64,
                "image_size_bytes": len(buf.getvalue()),
            })
        except Exception as e:
            candidates.append({"model_id": model_info.id, "model_name": model_info.name, "error": str(e)})

    candidates.sort(key=lambda c: c.get("quality", {}).get("overall", 0) if c.get("quality") else 0, reverse=True)

    return {
        "analysis": analysis,
        "scale": scale,
        "candidates": candidates,
        "best_candidate": candidates[0]["model_id"] if candidates else None,
    }
