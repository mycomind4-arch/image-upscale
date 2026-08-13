import numpy as np
from PIL import Image


def score_candidate(original: Image.Image, candidate: Image.Image) -> dict:
    src = np.asarray(original.convert('RGB').resize(candidate.size, Image.Resampling.LANCZOS), dtype=np.float32)
    out = np.asarray(candidate.convert('RGB'), dtype=np.float32)
    mae = float(np.mean(np.abs(src - out)))
    gray = np.mean(out, axis=2)
    edge = float(np.mean(np.abs(np.diff(gray, axis=1))) + np.mean(np.abs(np.diff(gray, axis=0))))
    fidelity = max(0.0, 1.0 - mae / 255.0)
    return {'fidelity': round(fidelity, 4), 'detail_score': round(edge, 5), 'mean_error': round(mae, 3), 'overall': round(0.7 * fidelity + 0.3 * min(edge / 0.5, 1.0), 4)}
