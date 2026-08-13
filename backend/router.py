from dataclasses import dataclass

@dataclass(frozen=True)
class Pipeline:
    name: str
    backend: str

GENERAL = Pipeline('general', 'realesrgan')
RESTORE = Pipeline('restore', 'diffbir')
FACE = Pipeline('face', 'codeformer')
FALLBACK = Pipeline('fallback', 'pillow')


def choose_pipeline(analysis: dict, mode: str = 'auto') -> Pipeline:
    if mode == 'fidelity':
        return GENERAL
    if mode == 'restoration':
        return RESTORE
    if mode == 'face':
        return FACE
    if mode not in {'auto', 'fidelity', 'restoration', 'face'}:
        return FALLBACK
    if analysis.get('degradation') in {'soft_or_blurry', 'low_contrast'}:
        return RESTORE
    return GENERAL
