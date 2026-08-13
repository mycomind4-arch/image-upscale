import os
from PIL import Image, ImageEnhance, ImageFilter


def _pillow_fallback(image: Image.Image, scale: int) -> Image.Image:
    size = (image.width * scale, image.height * scale)
    out = image.resize(size, Image.Resampling.LANCZOS)
    out = out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=3))
    return out


def _realesrgan(image: Image.Image, scale: int) -> Image.Image:
    try:
        from realesrgan import RealESRGAN
        import torch
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model = RealESRGAN(device, scale=4)
        model.load_weights(os.getenv('REALESRGAN_WEIGHTS', 'weights/RealESRGAN_x4plus.pth'), download=True)
        out = model.predict(image)
        if scale != 4:
            out = out.resize((image.width * scale, image.height * scale), Image.Resampling.LANCZOS)
        return out
    except Exception:
        return _pillow_fallback(image, scale)


def run_pipeline(image: Image.Image, pipeline, scale: int = 4, fidelity: float = 0.75) -> Image.Image:
    if pipeline.backend == 'realesrgan':
        result = _realesrgan(image, scale)
    else:
        result = _pillow_fallback(image, scale)
    # Fidelity blend prevents aggressive enhancement from drifting too far from source.
    if 0 <= fidelity < 1:
        source = image.resize(result.size, Image.Resampling.LANCZOS)
        result = Image.blend(source, result, fidelity)
    return result
