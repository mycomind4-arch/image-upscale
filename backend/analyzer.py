from PIL import Image, ImageStat
import numpy as np


def _detect_faces(image: Image.Image) -> dict:
    """Detect faces using available methods. Returns count and regions."""
    try:
        # Try facexlib first (used by CodeFormer)
        from facexlib.detector import init_detection_model
        import torch
        detector = init_detection_model('retinaface_resnet50', device='cpu')
        import numpy as _np
        arr = _np.array(image.convert('RGB'))
        from facexlib.utils.face_restoration_helper import FaceRestoreHelper
        # Use detection
        bboxes = detector.detect_faces(arr, 0.5)
        faces = []
        for bbox in bboxes:
            x1, y1, x2, y2, score = bbox[:5]
            faces.append({
                'bbox': [int(x1), int(y1), int(x2), int(y2)],
                'score': round(float(score), 3),
            })
        return {'count': len(faces), 'faces': faces, 'source': 'facexlib'}
    except Exception:
        pass

    try:
        # Try OpenCV haar cascade as fallback
        import cv2
        gray = cv2.cvtColor(np.array(image.convert('RGB')), cv2.COLOR_RGB2GRAY)
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        cascade = cv2.CascadeClassifier(cascade_path)
        detections = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
        faces = []
        for (x, y, w, h) in detections:
            faces.append({'bbox': [int(x), int(y), int(x + w), int(y + h)], 'score': 1.0})
        return {'count': len(faces), 'faces': faces, 'source': 'opencv'}
    except Exception:
        pass

    # No detector available
    return {'count': 0, 'faces': [], 'source': None}


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

    # Face detection (best-effort, non-blocking)
    try:
        face_info = _detect_faces(image)
    except Exception:
        face_info = {'count': 0, 'faces': [], 'source': None}

    return {
        "width": width, "height": height, "pixels": width * height,
        "aspect_ratio": round(width / max(height, 1), 4),
        "mean_luminance": round(mean, 3),
        "contrast": round(contrast, 3),
        "edge_strength": round(edge, 6),
        "resolution_class": resolution_class,
        "degradation": degradation,
        "image_type": image_type,
        "faces": face_info,
    }
