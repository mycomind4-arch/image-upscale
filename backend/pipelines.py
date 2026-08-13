import os
from PIL import Image, ImageFilter


def _fallback(image, scale):
    out = image.resize((image.width * scale, image.height * scale), Image.Resampling.LANCZOS)
    return out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=3))


def _realesrgan(image, scale):
    try:
        from realesrgan import RealESRGAN
        import torch
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model = RealESRGAN(device, scale=4)
        model.load_weights(os.getenv('REALESRGAN_WEIGHTS', 'weights/RealESRGAN_x4plus.pth'), download=True)
        out = model.predict(image)
        return out if scale == 4 else out.resize((image.width * scale, image.height * scale), Image.Resampling.LANCZOS)
    except Exception:
        return _fallback(image, scale)


def _spandrel(image, scale):
    try:
        import torch
        from spandrel import ImageModelDescriptor, ModelLoader
        weights = os.getenv('SPANDREL_WEIGHTS')
        if not weights or not os.path.exists(weights):
            return _realesrgan(image, scale)
        model = ModelLoader().load_from_file(weights)
        if not isinstance(model, ImageModelDescriptor):
            return _realesrgan(image, scale)
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model = model.to(device).eval()
        tensor = model.tensor_from_pil_image(image).to(device)
        with torch.inference_mode():
            output = model(tensor)
        return model.image_from_tensor(output)
    except Exception:
        return _realesrgan(image, scale)


def run_pipeline(image, pipeline, scale=4, fidelity=0.75):
    if pipeline.backend == 'realesrgan':
        result = _realesrgan(image, scale)
    elif pipeline.backend == 'spandrel':
        result = _spandrel(image, scale)
    else:
        result = _fallback(image, scale)
    if 0 <= fidelity < 1:
        source = image.resize(result.size, Image.Resampling.LANCZOS)
        result = Image.blend(source, result, fidelity)
    return result
