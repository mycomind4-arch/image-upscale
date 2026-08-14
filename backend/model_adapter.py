"""
Model Adapter Interface — clean abstraction for image enhancement models.

Every model implementation (Real-ESRGAN, SwinIR, HAT, etc.) sits behind this
interface so the FastAPI endpoints never contain model-specific logic.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List
from PIL import Image
import logging

logger = logging.getLogger(__name__)


class ModelStatus(str, Enum):
    AVAILABLE = "available"
    NOT_INSTALLED = "not_installed"
    UNSUPPORTED = "unsupported"
    COMING_SOON = "coming_soon"


@dataclass
class ModelInfo:
    """Describes a model's identity and capabilities."""
    id: str
    name: str
    family: str
    description: str
    supported_scales: List[int]
    supported_image_types: List[str]
    requires_gpu: bool
    supports_tiling: bool
    supports_faces: bool
    status: ModelStatus = ModelStatus.NOT_INSTALLED
    weight_path: Optional[str] = None
    notes: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "family": self.family,
            "description": self.description,
            "supported_scales": self.supported_scales,
            "supported_image_types": self.supported_image_types,
            "requires_gpu": self.requires_gpu,
            "supports_tiling": self.supports_tiling,
            "supports_faces": self.supports_faces,
            "status": self.status.value,
            "weight_path": self.weight_path,
            "notes": self.notes,
        }


class ModelAdapter(ABC):
    """Base class for all model implementations."""

    def __init__(self, info: ModelInfo):
        self.info = info
        self._model = None
        self._loaded = False

    @abstractmethod
    def _load(self) -> None:
        """Load the model into memory. Called once, lazily."""
        ...

    @abstractmethod
    def _enhance(self, image: Image.Image, scale: int, **kwargs) -> Image.Image:
        """Run inference on a single image."""
        ...

    def load(self) -> None:
        """Lazily load the model if not already loaded."""
        if not self._loaded:
            logger.info(f"Loading model: {self.info.id}")
            self._load()
            self._loaded = True
            logger.info(f"Model loaded: {self.info.id}")

    def enhance(self, image: Image.Image, scale: int, **kwargs) -> Image.Image:
        """Load (if needed) then run enhancement."""
        self.load()
        if scale not in self.info.supported_scales:
            raise ValueError(
                f"Scale {scale}x not supported by {self.info.id}. "
                f"Supported: {self.info.supported_scales}"
            )
        return self._enhance(image, scale, **kwargs)

    def unload(self) -> None:
        """Release model from memory."""
        self._model = None
        self._loaded = False
        logger.info(f"Unloaded model: {self.info.id}")

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def estimate_memory_mb(self, width: int, height: int, scale: int) -> int:
        """Rough VRAM/RAM estimate in MB. Override for better estimates."""
        out_pixels = width * scale * height * scale
        base_mb = (out_pixels * 4 * 3) / (1024 * 1024)
        return int(base_mb * 2.5)
