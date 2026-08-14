"""
Model Registry — central catalog of all enhancement models.

Each model is registered with its adapter class, metadata, and availability status.
The registry lazily instantiates adapters and caches loaded models.
"""
from __future__ import annotations
import os
import logging
from pathlib import Path
from typing import Optional, Dict, List
from backend.model_adapter import ModelAdapter, ModelInfo, ModelStatus
from backend.adapters.realesrgan_adapter import RealESRGANAdapter, check_realesrgan_available, download_if_possible
from backend.adapters.spandrel_adapter import SpandrelAdapter, check_spandrel_available

logger = logging.getLogger(__name__)

MODELS_DIR = Path(os.getenv("IMAGE_UPSCALE_MODEL_DIR", Path.home() / ".image-upscale" / "models"))

_MODEL_DEFS = [
    {
        "id": "realesrgan-x4plus",
        "name": "Real-ESRGAN x4plus",
        "family": "Real-ESRGAN",
        "description": "General-purpose 4x upscaler for photographs. Best all-around quality.",
        "supported_scales": [4],
        "supported_image_types": ["photo", "artwork", "document"],
        "requires_gpu": False,
        "supports_tiling": True,
        "supports_faces": False,
        "adapter": "realesrgan",
        "filename": "realesrgan-x4plus.pth",
    },
    {
        "id": "realesrgan-x2plus",
        "name": "Real-ESRGAN x2plus",
        "family": "Real-ESRGAN",
        "description": "2x upscaler for photographs. Preserves more detail than 4x at lower scale.",
        "supported_scales": [2],
        "supported_image_types": ["photo", "artwork", "document"],
        "requires_gpu": False,
        "supports_tiling": True,
        "supports_faces": False,
        "adapter": "realesrgan",
        "filename": "realesrgan-x2plus.pth",
    },
    {
        "id": "realesr-general-x4v3",
        "name": "Real-ESRGAN General",
        "family": "Real-ESRGAN",
        "description": "Lighter 4x model with denoising support. Faster than x4plus.",
        "supported_scales": [4],
        "supported_image_types": ["photo", "artwork"],
        "requires_gpu": False,
        "supports_tiling": True,
        "supports_faces": False,
        "adapter": "realesrgan",
        "filename": "realesr-general-x4v3.pth",
    },
    {
        "id": "swinir",
        "name": "SwinIR",
        "family": "SwinIR",
        "description": "Transformer-based super resolution. Good for natural images.",
        "supported_scales": [4],
        "supported_image_types": ["photo", "artwork"],
        "requires_gpu": False,
        "supports_tiling": False,
        "supports_faces": False,
        "adapter": "spandrel",
        "filename": "swinir.pth",
    },
    {
        "id": "hat",
        "name": "HAT",
        "family": "HAT",
        "description": "Hybrid Attention Transformer. State-of-the-art for natural images.",
        "supported_scales": [4],
        "supported_image_types": ["photo"],
        "requires_gpu": False,
        "supports_tiling": False,
        "supports_faces": False,
        "adapter": "spandrel",
        "filename": "hat.pth",
    },
    {
        "id": "codeformer",
        "name": "CodeFormer",
        "family": "CodeFormer",
        "description": "Face restoration model. Requires face detection. Scale 1 (restoration only).",
        "supported_scales": [1],
        "supported_image_types": ["portrait", "photo"],
        "requires_gpu": False,
        "supports_tiling": False,
        "supports_faces": True,
        "adapter": "codeformer",
        "filename": "codeformer.pth",
    },
    {
        "id": "diffbir",
        "name": "DiffBIR",
        "family": "DiffBIR",
        "description": "Diffusion-based blind image restoration. Not yet implemented.",
        "supported_scales": [4],
        "supported_image_types": ["photo"],
        "requires_gpu": True,
        "supports_tiling": True,
        "supports_faces": False,
        "adapter": "diffbir",
        "filename": "diffbir.pth",
    },
]


class ModelRegistry:
    """Central registry that manages model adapters and caching."""

    def __init__(self):
        self._adapters: Dict[str, ModelAdapter] = {}
        self._infos: Dict[str, ModelInfo] = {}
        self._initialize()

    def _initialize(self):
        for defn in _MODEL_DEFS:
            weight_path = MODELS_DIR / defn["filename"]

            if defn["adapter"] == "diffbir":
                status = ModelStatus.UNSUPPORTED
                notes = "DiffBIR pipeline not yet implemented"
            elif defn["adapter"] == "codeformer":
                if check_realesrgan_available(str(weight_path)):
                    status = ModelStatus.AVAILABLE
                else:
                    status = ModelStatus.NOT_INSTALLED
                    notes = "CodeFormer weights not installed. Place at: " + str(weight_path)
            elif defn["adapter"] == "realesrgan":
                if check_realesrgan_available(str(weight_path)):
                    status = ModelStatus.AVAILABLE
                    notes = None
                else:
                    status = ModelStatus.NOT_INSTALLED
                    notes = f"Weights not found at {weight_path}. Will auto-download on first use."
            elif defn["adapter"] == "spandrel":
                if check_spandrel_available(str(weight_path)):
                    status = ModelStatus.AVAILABLE
                    notes = None
                else:
                    status = ModelStatus.NOT_INSTALLED
                    notes = f"Place model weights at: {weight_path}"
            else:
                status = ModelStatus.UNSUPPORTED
                notes = "Unknown adapter type"

            info = ModelInfo(
                id=defn["id"],
                name=defn["name"],
                family=defn["family"],
                description=defn["description"],
                supported_scales=defn["supported_scales"],
                supported_image_types=defn["supported_image_types"],
                requires_gpu=defn["requires_gpu"],
                supports_tiling=defn["supports_tiling"],
                supports_faces=defn["supports_faces"],
                status=status,
                weight_path=str(weight_path),
                notes=notes,
            )
            self._infos[info.id] = info

    def get_info(self, model_id: str) -> Optional[ModelInfo]:
        return self._infos.get(model_id)

    def list_models(self) -> List[ModelInfo]:
        return list(self._infos.values())

    def available_models(self) -> List[ModelInfo]:
        return [m for m in self._infos.values() if m.status == ModelStatus.AVAILABLE]

    def get_adapter(self, model_id: str) -> Optional[ModelAdapter]:
        if model_id not in self._infos:
            return None

        info = self._infos[model_id]
        if info.status != ModelStatus.AVAILABLE:
            return None

        if model_id in self._adapters:
            return self._adapters[model_id]

        defn = next(d for d in _MODEL_DEFS if d["id"] == model_id)
        adapter_type = defn["adapter"]

        if adapter_type == "realesrgan":
            adapter = RealESRGANAdapter(info, info.weight_path, tile=0, tile_pad=10)
        elif adapter_type == "spandrel":
            adapter = SpandrelAdapter(info, info.weight_path)
        else:
            return None

        self._adapters[model_id] = adapter
        return adapter

    def unload_all(self):
        for adapter in self._adapters.values():
            adapter.unload()
        self._adapters.clear()
        logger.info("All models unloaded")

    def ensure_weights(self, model_id: str) -> bool:
        info = self._infos.get(model_id)
        if not info:
            return False
        if info.status == ModelStatus.AVAILABLE:
            return True

        defn = next(d for d in _MODEL_DEFS if d["id"] == model_id)
        if defn["adapter"] == "realesrgan":
            if download_if_possible(model_id, info.weight_path):
                if check_realesrgan_available(info.weight_path):
                    info.status = ModelStatus.AVAILABLE
                    info.notes = None
                    return True
        return False


registry = ModelRegistry()


def torch_device() -> dict:
    try:
        import torch
        if torch.cuda.is_available():
            return {"device": "cuda", "vram_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2)}
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return {"device": "mps", "vram_gb": None}
    except ImportError:
        pass
    except Exception:
        pass
    return {"device": "cpu", "vram_gb": None}


def capabilities() -> dict:
    return {
        "models_dir": str(MODELS_DIR),
        "device": torch_device(),
        "models": [m.to_dict() for m in registry.list_models()],
    }
