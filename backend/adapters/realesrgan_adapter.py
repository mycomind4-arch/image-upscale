"""
Real-ESRGAN adapter — uses the official realesrgan package (RealESRGANer).

Supports:
  - RealESRGAN_x4plus  (RRDBNet, 4x, general photos)
  - RealESRGAN_x2plus  (RRDBNet, 2x, general photos)
  - realesr-general-x4v3 (SRVGGNetCompact, 4x, faster/lighter)
"""
from __future__ import annotations
import os
import logging
import numpy as np
import cv2
from PIL import Image
from backend.model_adapter import ModelAdapter, ModelInfo, ModelStatus

logger = logging.getLogger(__name__)

_WEIGHT_URLS = {
    "realesrgan-x4plus": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
    "realesrgan-x2plus": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth",
    "realesr-general-x4v3": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
}

_ARCH_CONFIGS = {
    "realesrgan-x4plus": ("RRDBNet", {"num_in_ch": 3, "num_out_ch": 3, "num_feat": 64, "num_block": 23, "num_grow_ch": 32, "scale": 4}),
    "realesrgan-x2plus": ("RRDBNet", {"num_in_ch": 3, "num_out_ch": 3, "num_feat": 64, "num_block": 23, "num_grow_ch": 32, "scale": 2}),
    "realesr-general-x4v3": ("SRVGGNetCompact", {"num_in_ch": 3, "num_out_ch": 3, "num_feat": 64, "num_conv": 32, "upscale": 4, "act_type": "prelu"}),
}


def _download_weights(model_id: str, dest_path: str) -> bool:
    """Download model weights if available. Returns True on success."""
    url = _WEIGHT_URLS.get(model_id)
    if not url:
        return False
    try:
        import urllib.request
        logger.info(f"Downloading weights for {model_id} from {url}")
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        urllib.request.urlretrieve(url, dest_path)
        return os.path.exists(dest_path) and os.path.getsize(dest_path) > 1000
    except Exception as e:
        logger.warning(f"Failed to download {model_id}: {e}")
        return False


class RealESRGANAdapter(ModelAdapter):
    """Real-ESRGAN model adapter using the official RealESRGANer."""

    def __init__(self, info: ModelInfo, weight_path: str, tile: int = 0, tile_pad: int = 10):
        super().__init__(info)
        self.weight_path = weight_path
        self.tile = tile
        self.tile_pad = tile_pad
        self._device = None

    def _load(self) -> None:
        from realesrgan import RealESRGANer
        import torch

        self._device = torch.device(
            "cuda" if torch.cuda.is_available()
            else "mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
            else "cpu"
        )

        model_id = self.info.id
        arch_name, arch_kwargs = _ARCH_CONFIGS[model_id]

        if arch_name == "RRDBNet":
            from basicsr.archs.rrdbnet_arch import RRDBNet
            arch = RRDBNet(**arch_kwargs)
        elif arch_name == "SRVGGNetCompact":
            from realesrgan.archs.srvgg_arch import SRVGGNetCompact
            arch = SRVGGNetCompact(**arch_kwargs)
        else:
            raise ValueError(f"Unknown architecture: {arch_name}")

        half = (self._device.type != "cpu")

        self._model = RealESRGANer(
            scale=self.info.supported_scales[0],
            model_path=self.weight_path,
            model=arch,
            tile=self.tile,
            tile_pad=self.tile_pad,
            pre_pad=10,
            half=half,
            device=self._device,
        )

    def _enhance(self, image: Image.Image, scale: int, **kwargs) -> Image.Image:
        img_rgb = np.array(image.convert("RGB"))
        img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)

        output_bgr, _ = self._model.enhance(img_bgr, outscale=scale)
        output_rgb = cv2.cvtColor(output_bgr, cv2.COLOR_BGR2RGB)
        return Image.fromarray(output_rgb)

    def unload(self) -> None:
        super().unload()
        self._model = None
        self._device = None


def check_realesrgan_available(weight_path: str) -> bool:
    """Check if RealESRGANer can be imported and weights exist."""
    try:
        import realesrgan  # noqa
        import basicsr  # noqa
        return os.path.exists(weight_path)
    except ImportError:
        return False


def download_if_possible(model_id: str, dest_path: str) -> bool:
    """Try to download weights for the given model ID."""
    if os.path.exists(dest_path) and os.path.getsize(dest_path) > 1000:
        return True
    return _download_weights(model_id, dest_path)
