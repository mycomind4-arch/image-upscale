"""
Spandrel adapter — loads SwinIR/HAT/other architectures via spandrel.

Spandrel auto-detects the architecture from the checkpoint file.
"""
from __future__ import annotations
import os
import logging
import numpy as np
from PIL import Image
from backend.model_adapter import ModelAdapter, ModelInfo, ModelStatus

logger = logging.getLogger(__name__)


class SpandrelAdapter(ModelAdapter):
    """Loads and runs spandrel-compatible image models (SwinIR, HAT, etc.)."""

    def __init__(self, info: ModelInfo, weight_path: str):
        super().__init__(info)
        self.weight_path = weight_path

    def _load(self) -> None:
        import torch
        from spandrel import ImageModelDescriptor, ModelLoader

        try:
            import spandrel_extra_arches
            spandrel_extra_arches.install()
        except ImportError:
            pass

        device = torch.device(
            "cuda" if torch.cuda.is_available()
            else "mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
            else "cpu"
        )

        model = ModelLoader().load_from_file(self.weight_path)
        if not isinstance(model, ImageModelDescriptor):
            raise ValueError(f"Unsupported model type for {self.info.id}: {type(model)}")

        self._model = model.to(device).eval()
        self._device = device
        self._native_scale = getattr(model, "scale", 1)

    def _enhance(self, image: Image.Image, scale: int, **kwargs) -> Image.Image:
        import torch

        arr = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
        tensor = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0).to(self._device)

        with torch.inference_mode():
            output = self._model(tensor).clamp(0, 1)

        out = output.squeeze(0).permute(1, 2, 0).cpu().numpy()
        result = Image.fromarray((out * 255.0 + 0.5).astype(np.uint8), "RGB")

        if scale != self._native_scale:
            target_size = (image.width * scale, image.height * scale)
            result = result.resize(target_size, Image.Resampling.LANCZOS)

        return result

    def unload(self) -> None:
        super().unload()
        self._model = None
        self._device = None


def check_spandrel_available(weight_path: str) -> bool:
    """Check if spandrel is importable and weights exist."""
    try:
        import spandrel  # noqa
        return os.path.exists(weight_path)
    except ImportError:
        return False
