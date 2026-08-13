from pathlib import Path
import numpy as np
from PIL import Image

class SpandrelEngine:
    def __init__(self, weight_path: str, device: str = 'cpu'):
        import torch
        from spandrel import ImageModelDescriptor, ModelLoader
        try:
            import spandrel_extra_arches
            spandrel_extra_arches.install()
        except ImportError:
            pass
        self.torch = torch
        self.device = torch.device(device)
        model = ModelLoader().load_from_file(weight_path)
        if not isinstance(model, ImageModelDescriptor):
            raise ValueError(f'Unsupported image model: {weight_path}')
        self.model = model.to(self.device).eval()
        self.scale = getattr(model, 'scale', 1)

    def run(self, image: Image.Image) -> Image.Image:
        arr = np.asarray(image.convert('RGB'), dtype=np.float32) / 255.0
        tensor = self.torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0).to(self.device)
        with self.torch.inference_mode():
            out = self.model(tensor).clamp(0, 1)
        out = out.squeeze(0).permute(1, 2, 0).cpu().numpy()
        return Image.fromarray((out * 255.0 + 0.5).astype(np.uint8), 'RGB')
