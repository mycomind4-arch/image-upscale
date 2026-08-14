"""
Enhancement pipelines — orchestrates model adapters and post-processing.
"""
from __future__ import annotations
import os
import time
import logging
from dataclasses import dataclass, field
from typing import Optional, List
from PIL import Image, ImageFilter
import numpy as np

from backend.model_adapter import ModelAdapter, ModelInfo, ModelStatus
from backend.model_registry import registry, torch_device

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    image: Image.Image
    pipeline: str
    model_id: str
    model_name: str
    scale: int
    device: str
    runtime_sec: float
    original_size: tuple
    enhanced_size: tuple
    used_fallback: bool = False
    fallback_reason: Optional[str] = None
    quality: Optional[dict] = None


@dataclass
class Pipeline:
    name: str
    model_id: str
    description: str = ""


GENERAL_4X = Pipeline("general-4x", "realesrgan-x4plus", "General-purpose 4x photo upscaling")
GENERAL_2X = Pipeline("general-2x", "realesrgan-x2plus", "General-purpose 2x photo upscaling")
GENERAL_FAST = Pipeline("general-fast", "realesr-general-x4v3", "Faster 4x with denoising support")
SWINIR_4X = Pipeline("swinir-4x", "swinir", "SwinIR 4x transformer upscaling")
HAT_4X = Pipeline("hat-4x", "hat", "HAT 4x transformer upscaling")
CODEFORMER = Pipeline("codeformer", "codeformer", "Face restoration")


def _fallback_upscale(image: Image.Image, scale: int) -> Image.Image:
    out = image.resize((image.width * scale, image.height * scale), Image.Resampling.LANCZOS)
    return out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=3))


def _fallback_face_upscale(image: Image.Image, scale: int) -> Image.Image:
    out = image.resize((image.width * scale, image.height * scale), Image.Resampling.LANCZOS)
    out = out.filter(ImageFilter.UnsharpMask(radius=0.8, percent=140, threshold=2))
    out = out.filter(ImageFilter.GaussianBlur(0.4))
    out = out.filter(ImageFilter.UnsharpMask(radius=0.6, percent=80, threshold=4))
    return out


def _blend_fidelity(original: Image.Image, enhanced: Image.Image, fidelity: float) -> Image.Image:
    if 0 <= fidelity < 1:
        source = original.resize(enhanced.size, Image.Resampling.LANCZOS)
        return Image.blend(source, enhanced, 1.0 - fidelity)
    return enhanced


def run_model_enhancement(
    image: Image.Image,
    model_id: str,
    scale: int,
    fidelity: float = 0.0,
    tile: int = 0,
    **kwargs,
) -> PipelineResult:
    """Run a single model enhancement with full error handling and metrics."""
    t0 = time.time()
    device_info = torch_device()
    device = device_info.get("device", "cpu")

    info = registry.get_info(model_id)
    if not info:
        raise ValueError(f"Unknown model: {model_id}")

    if info.status != ModelStatus.AVAILABLE:
        if not registry.ensure_weights(model_id):
            raise RuntimeError(f"Model '{info.name}' is {info.status.value}. {info.notes or ''}")
        info = registry.get_info(model_id)

    adapter = registry.get_adapter(model_id)
    if not adapter:
        raise RuntimeError(f"No adapter available for model: {model_id}")

    if scale not in info.supported_scales:
        raise ValueError(f"Scale {scale}x not supported by {info.name}. Supported: {info.supported_scales}")

    result = adapter.enhance(image, scale, **kwargs)

    if fidelity > 0:
        result = _blend_fidelity(image, result, fidelity)

    t1 = time.time()

    return PipelineResult(
        image=result,
        pipeline=model_id,
        model_id=model_id,
        model_name=info.name,
        scale=scale,
        device=device,
        runtime_sec=round(t1 - t0, 3),
        original_size=image.size,
        enhanced_size=result.size,
        used_fallback=False,
    )


def run_pipeline(
    image: Image.Image,
    pipeline: Pipeline,
    scale: int = 4,
    fidelity: float = 0.0,
    **kwargs,
) -> PipelineResult:
    """Run a named pipeline. Falls back to PIL only if model genuinely unavailable."""
    try:
        return run_model_enhancement(image, pipeline.model_id, scale, fidelity, **kwargs)
    except Exception as e:
        logger.warning(f"Model {pipeline.model_id} failed, using PIL fallback: {e}")
        t0 = time.time()
        if pipeline.model_id == "codeformer" or "face" in pipeline.name:
            result_img = _fallback_face_upscale(image, scale)
        else:
            result_img = _fallback_upscale(image, scale)
        t1 = time.time()
        return PipelineResult(
            image=result_img,
            pipeline=pipeline.name,
            model_id=pipeline.model_id,
            model_name=f"PIL Fallback ({pipeline.name})",
            scale=scale,
            device=torch_device().get("device", "cpu"),
            runtime_sec=round(t1 - t0, 3),
            original_size=image.size,
            enhanced_size=result_img.size,
            used_fallback=True,
            fallback_reason=str(e),
        )


def run_candidate(
    image: Image.Image,
    model_id: str,
    scale: int,
    fidelity: float = 0.0,
    **kwargs,
) -> PipelineResult:
    """Run a single model as a candidate."""
    return run_pipeline(image, Pipeline(model_id, model_id), scale, fidelity, **kwargs)
