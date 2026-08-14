"""
Model Router — selects the best enhancement pipeline based on image analysis.
Deterministic, transparent rules. Every decision includes a human-readable reason.
"""
from __future__ import annotations
import logging
from dataclasses import dataclass
from typing import Optional, List
from backend.model_adapter import ModelStatus
from backend.model_registry import registry
from backend.pipelines import (
    Pipeline, GENERAL_4X, GENERAL_2X, GENERAL_FAST,
    SWINIR_4X, HAT_4X, CODEFORMER,
)

logger = logging.getLogger(__name__)


@dataclass
class RouterDecision:
    pipeline: Pipeline
    recommended_model: str
    confidence: str
    reason: str
    detected_type: str
    alternatives: List[dict]


def _model_available(model_id: str) -> bool:
    info = registry.get_info(model_id)
    return info is not None and info.status == ModelStatus.AVAILABLE


def _model_supports_scale(model_id: str, scale: int) -> bool:
    info = registry.get_info(model_id)
    return info is not None and info.status == ModelStatus.AVAILABLE and scale in info.supported_scales


def choose_pipeline(analysis: dict, mode: str = "auto", scale: int = 4) -> Pipeline:
    """Return the Pipeline object for a given mode and scale."""
    if mode == "fidelity":
        if _model_supports_scale("realesrgan-x4plus", scale):
            return GENERAL_4X
        if _model_supports_scale("realesrgan-x2plus", scale):
            return GENERAL_2X
        return GENERAL_4X  # will fallback with clear error
    if mode == "balanced":
        if _model_supports_scale("realesrgan-x4plus", scale):
            return GENERAL_4X
        if _model_supports_scale("realesrgan-x2plus", scale):
            return GENERAL_2X
        return GENERAL_4X
    if mode == "detail":
        if _model_supports_scale("realesr-general-x4v3", scale):
            return GENERAL_FAST
        return GENERAL_4X
    if mode == "best":
        if _model_supports_scale("realesrgan-x4plus", scale):
            return GENERAL_4X
        return GENERAL_2X
    if mode == "face":
        return CODEFORMER
    return _auto_select(analysis, scale).pipeline


def _auto_select(analysis: dict, scale: int = 4) -> RouterDecision:
    faces = analysis.get("faces", {})
    face_count = faces.get("count", 0)
    degradation = analysis.get("degradation", "normal")
    resolution_class = analysis.get("resolution_class", "medium")
    image_type = analysis.get("image_type", "photo")

    # Rule 1: Portraits with faces → face restoration
    if face_count > 0 and _model_available("codeformer"):
        return RouterDecision(
            pipeline=CODEFORMER, recommended_model="codeformer",
            confidence="high",
            reason=f"Detected {face_count} face(s). CodeFormer is available for face restoration.",
            detected_type="portrait",
            alternatives=[{"model": "realesrgan-x4plus", "reason": "General upscaling without face restoration"}],
        )

    # Rule 2: Heavily compressed or degraded → general-fast (has denoising)
    if degradation in ("soft_or_blurry", "low_contrast") and _model_supports_scale("realesr-general-x4v3", scale):
        return RouterDecision(
            pipeline=GENERAL_FAST, recommended_model="realesr-general-x4v3",
            confidence="high",
            reason=f"Image shows {degradation} characteristics. General model with denoising support selected.",
            detected_type=image_type,
            alternatives=[{"model": "realesrgan-x4plus", "reason": "Higher quality but no denoising"}],
        )

    # Rule 3: Low resolution → prefer transformer models, fall back to realesrgan
    if resolution_class in ("very_low", "low"):
        if _model_supports_scale("hat", scale):
            return RouterDecision(
                pipeline=HAT_4X, recommended_model="hat", confidence="medium",
                reason=f"Low resolution ({resolution_class}) image. HAT transformer selected for best detail recovery.",
                detected_type=image_type,
                alternatives=[{"model": "realesrgan-x4plus", "reason": "Faster, proven quality"}],
            )
        if _model_supports_scale("swinir", scale):
            return RouterDecision(
                pipeline=SWINIR_4X, recommended_model="swinir", confidence="medium",
                reason=f"Low resolution ({resolution_class}) image. SwinIR transformer selected for detail recovery.",
                detected_type=image_type,
                alternatives=[{"model": "realesrgan-x4plus", "reason": "Faster inference"}],
            )
        if _model_supports_scale("realesrgan-x4plus", scale):
            return RouterDecision(
                pipeline=GENERAL_4X, recommended_model="realesrgan-x4plus", confidence="high",
                reason=f"Low resolution ({resolution_class}) image. Real-ESRGAN 4x for reliable upscaling.",
                detected_type=image_type,
                alternatives=[{"model": "realesr-general-x4v3", "reason": "Faster with denoising"}],
            )

    # Rule 4: Default — general realesrgan
    if _model_supports_scale("realesrgan-x4plus", scale):
        return RouterDecision(
            pipeline=GENERAL_4X, recommended_model="realesrgan-x4plus", confidence="high",
            reason="General-purpose photograph. Real-ESRGAN x4plus provides best all-around quality.",
            detected_type=image_type,
            alternatives=[
                {"model": "realesr-general-x4v3", "reason": "Faster, with denoising"},
                {"model": "swinir", "reason": "Transformer-based, may recover more detail"},
            ],
        )

    # Rule 5: Try 2x if 4x unavailable for requested scale
    if scale == 2 and _model_supports_scale("realesrgan-x2plus", scale):
        return RouterDecision(
            pipeline=GENERAL_2X, recommended_model="realesrgan-x2plus", confidence="high",
            reason="2x upscale requested. Real-ESRGAN x2plus selected.",
            detected_type=image_type,
            alternatives=[],
        )

    # Rule 6: No models available for this scale
    fallback = Pipeline("fallback", "fallback", "PIL LANCZOS fallback")
    return RouterDecision(
        pipeline=fallback, recommended_model="fallback", confidence="low",
        reason=f"No enhancement models available for {scale}x scale. Using LANCZOS interpolation.",
        detected_type=image_type, alternatives=[],
    )


def route(analysis: dict, mode: str = "auto", scale: int = 4) -> RouterDecision:
    """Get full routing decision with explanation."""
    if mode == "fidelity":
        return RouterDecision(GENERAL_4X, "realesrgan-x4plus", "high",
            "User selected Fidelity mode — preserves original information.",
            analysis.get("image_type", "photo"), [])
    if mode == "balanced":
        return RouterDecision(GENERAL_4X, "realesrgan-x4plus", "high",
            "Balanced mode — general-purpose enhancement.",
            analysis.get("image_type", "photo"), [])
    if mode == "detail":
        return RouterDecision(GENERAL_FAST, "realesr-general-x4v3", "high",
            "Detail mode — allows stronger AI reconstruction.",
            analysis.get("image_type", "photo"), [])
    if mode == "face":
        return RouterDecision(CODEFORMER, "codeformer", "high",
            "Face restoration requested.", "portrait", [])
    return _auto_select(analysis, scale)
