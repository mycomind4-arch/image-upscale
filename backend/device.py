import os

def get_device_info():
    info = {"device": "cpu", "cuda": False, "mps": False, "gpu_name": None, "vram_gb": None}
    try:
        import torch
        if torch.cuda.is_available():
            i = torch.cuda.current_device()
            props = torch.cuda.get_device_properties(i)
            info.update({"device": f"cuda:{i}", "cuda": True, "gpu_name": props.name, "vram_gb": round(props.total_memory / 1024**3, 2)})
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            info.update({"device": "mps", "mps": True, "gpu_name": "Apple Silicon GPU"})
    except Exception as exc:
        info["error"] = str(exc)
    return info

def torch_device():
    import torch
    info = get_device_info()
    return torch.device(info["device"])
