"""
Quality Evaluator — perceptual quality and artifact detection for upscaled images.

Metrics:
  - fidelity:       how closely the enhanced image matches the source (1.0 = exact)
  - sharpness:      Laplacian variance (higher = sharper edges)
  - contrast:       standard deviation of luminance
  - detail_score:    edge density compared to source
  - artifact_score:  ringing/blocking artifact detection (lower = cleaner)
  - hallucination:   deviation in smooth regions (generative reconstruction indicator)
  - overall:         weighted composite score
"""
import numpy as np
from PIL import Image, ImageFilter


def _laplacian_variance(gray: np.ndarray) -> float:
    """Sharpness via Laplacian kernel variance."""
    kernel = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
    h, w = gray.shape
    pad = np.pad(gray, 1, mode='edge')
    lap = np.zeros_like(gray, dtype=np.float32)
    for i in range(3):
        for j in range(3):
            lap += kernel[i, j] * pad[i:i + h, j:j + w]
    return float(np.var(lap))


def _edge_density(gray: np.ndarray) -> float:
    """Average edge magnitude using simple gradients."""
    gy = np.abs(np.diff(gray, axis=0))
    gx = np.abs(np.diff(gray, axis=1))
    # Pad to match dimensions
    gy = np.pad(gy, ((0, 1), (0, 0)), mode='edge')
    gx = np.pad(gx, ((0, 0), (0, 1)), mode='edge')
    return float(np.mean(np.sqrt(gx ** 2 + gy ** 2)))


def _gaussian_blur(gray: np.ndarray, radius: float) -> np.ndarray:
    """Apply Gaussian blur via PIL."""
    img = Image.fromarray(gray.astype(np.uint8))
    blurred = img.filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(blurred, dtype=np.float32)


def _detect_artifacts(out: np.ndarray) -> float:
    """Detect ringing/blocking artifacts via high-freq energy in smooth regions."""
    gray = np.mean(out, axis=2).astype(np.float32)
    blurred = _gaussian_blur(gray, 2.0)
    hp = np.abs(gray - blurred)
    # Threshold: pixels where hp is low but not zero
    smooth_mask = (hp < 3.0) & (hp > 0.01)
    if smooth_mask.sum() < 100:
        return 0.0
    # In smooth regions, any residual high-freq = artifacts
    artifact_energy = float(np.mean(hp[smooth_mask]))
    # Normalize to 0-1 scale (empirical)
    return min(artifact_energy / 2.0, 1.0)


def _smooth_region_deviation(src: np.ndarray, out: np.ndarray) -> float:
    """Measure deviation in smooth regions — indicates hallucination."""
    src_gray = np.mean(src, axis=2).astype(np.float32)
    out_gray = np.mean(out, axis=2).astype(np.float32)
    # Identify smooth regions in source (low local variance)
    blurred = _gaussian_blur(src_gray, 3.0)
    hp = np.abs(src_gray - blurred)
    smooth_mask = hp < 2.0
    if smooth_mask.sum() < 100:
        return 0.0
    # In smooth regions, how much did the enhanced image change?
    diff = np.abs(out_gray - src_gray)
    return float(np.mean(diff[smooth_mask]))


def score_candidate(original: Image.Image, candidate: Image.Image) -> dict:
    """Full quality evaluation of an enhanced image vs its source."""
    # Resize source to match candidate for comparison
    src_resized = original.convert('RGB').resize(candidate.size, Image.Resampling.LANCZOS)
    src = np.asarray(src_resized, dtype=np.float32)
    out = np.asarray(candidate.convert('RGB'), dtype=np.float32)

    # --- Fidelity (pixel-level similarity) ---
    mae = float(np.mean(np.abs(src - out)))
    fidelity = max(0.0, 1.0 - mae / 255.0)

    # --- Sharpness (Laplacian variance) ---
    out_gray = np.mean(out, axis=2).astype(np.float32)
    src_gray = np.mean(src, axis=2).astype(np.float32)
    sharpness = _laplacian_variance(out_gray)
    src_sharpness = _laplacian_variance(src_gray)
    sharpness_gain = sharpness / max(src_sharpness, 1e-6)

    # --- Contrast ---
    contrast = float(np.std(out_gray))

    # --- Detail (edge density) ---
    detail = _edge_density(out_gray)
    src_detail = _edge_density(src_gray)
    detail_gain = detail / max(src_detail, 1e-6)

    # --- Artifact detection ---
    artifact_score = _detect_artifacts(out)

    # --- Hallucination (smooth region deviation) ---
    hallucination = _smooth_region_deviation(src, out)
    hallucination_flag = hallucination > 3.0

    # --- Overall composite ---
    overall = (
        0.30 * fidelity +
        0.25 * min(sharpness_gain / 2.0, 1.0) +
        0.20 * min(detail_gain / 2.0, 1.0) +
        0.15 * (1.0 - artifact_score) +
        0.10 * (1.0 - min(hallucination / 5.0, 1.0))
    )
    overall = max(0.0, min(1.0, overall))

    return {
        'fidelity': round(fidelity, 4),
        'sharpness': round(sharpness, 2),
        'sharpness_gain': round(sharpness_gain, 3),
        'contrast': round(contrast, 2),
        'detail_score': round(detail, 5),
        'detail_gain': round(detail_gain, 3),
        'artifact_score': round(artifact_score, 4),
        'hallucination': round(hallucination, 3),
        'hallucination_warning': bool(hallucination_flag),
        'mean_error': round(mae, 3),
        'overall': round(overall, 4),
    }


def compare_candidates(original: Image.Image, candidates: dict) -> list:
    """Compare multiple enhanced versions of the same source.
    
    Args:
        original: source image
        candidates: {name: enhanced_image} dict
    
    Returns:
        Sorted list of {name, scores} dicts, best overall first.
    """
    results = []
    for name, img in candidates.items():
        scores = score_candidate(original, img)
        results.append({'name': name, **scores})
    results.sort(key=lambda r: r['overall'], reverse=True)
    return results
