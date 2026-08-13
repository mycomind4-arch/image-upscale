from PIL import Image, ImageStat
import numpy as np


def analyze_image(image: Image.Image) -> dict:
    width, height = image.size
    stat = ImageStat.Stat(image.convert("RGB"))
    mean = float(sum(stat.mean) / 3.0)
    contrast = float(sum(stat.stddev) / 3.0)
    gray = np.asarray(image.convert("L"), dtype=np.float32) / 255.0
    edge = float(np.mean(np.abs(np.diff(gray, axis=1))) + np.mean(np.abs(np.diff(gray, axis=0))))
    if width <= 256 or height <= 256:
        resolution_class = "very_low"
    elif width <= 640 or height <= 640:
        resolution_class = "low"
    elif width <= 1280 or height <= 1280:
        resolution_class = "medium"
    else:
        resolution_class = "high"
    degradation = "low_contrast" if contrast < 18 else ("soft_or_blurry" if edge < 0.035 else "normal")
    image_type = "document_or_banner" if max(width / max(height, 1), height / max(width, 1)) > 3.5 else "photo"
    return {"width": width, "height": height, "pixels": width * height, "aspect_ratio": round(width / max(height, 1), 4), "mean_luminance": round(mean, 3), "contrast": round(contrast, 3), "edge_strength": round(edge, 6), "resolution_class": resolution_class, "degradation": degradation, "image_type": image_type}
