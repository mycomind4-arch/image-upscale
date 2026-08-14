from dataclasses import dataclass, asdict
from pathlib import Path
import importlib.util
import os

ROOT = Path(os.getenv('IMAGE_UPSCALE_MODEL_DIR', Path.home() / '.image-upscale' / 'models'))

@dataclass(frozen=True)
class ModelSpec:
    id: str
    family: str
    scale: int
    backend: str
    weight_env: str | None = None
    optional: bool = True

MODELS = [
    ModelSpec('realesrgan-x4plus', 'Real-ESRGAN', 4, 'realesrgan', 'REALESRGAN_X4PLUS_WEIGHTS'),
    ModelSpec('realesrgan-x2plus', 'Real-ESRGAN', 2, 'realesrgan', 'REALESRGAN_X2PLUS_WEIGHTS'),
    ModelSpec('realesr-general-x4v3', 'Real-ESRGAN', 4, 'realesrgan', 'REALESRGAN_GENERAL_WEIGHTS'),
    ModelSpec('swinir', 'SwinIR', 4, 'spandrel', 'SWINIR_WEIGHTS'),
    ModelSpec('hat', 'HAT', 4, 'spandrel', 'HAT_WEIGHTS'),
    ModelSpec('codeformer', 'CodeFormer', 1, 'codeformer', 'CODEFORMER_WEIGHTS'),
    ModelSpec('diffbir', 'DiffBIR', 4, 'diffbir', 'DIFFBIR_WEIGHTS'),
]

def model_status():
    result = []
    for spec in MODELS:
        env = os.getenv(spec.weight_env) if spec.weight_env else None
        path = Path(env) if env else ROOT / f'{spec.id}.pth'
        result.append({**asdict(spec), 'weight_path': str(path), 'installed': path.exists()})
    return result

def torch_device():
    try:
        import torch
        if torch.cuda.is_available():
            return {'device': 'cuda', 'vram_gb': round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2)}
        if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
            return {'device': 'mps', 'vram_gb': None}
    except Exception:
        pass
    return {'device': 'cpu', 'vram_gb': None}

def capabilities():
    return {'models_dir': str(ROOT), 'device': torch_device(), 'models': model_status()}
