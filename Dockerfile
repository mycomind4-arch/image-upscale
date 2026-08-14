FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libgomp1 wget ca-certificates \
    && apt-get clean && rm -f /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt backend/requirements-ml.txt /app/backend/
RUN pip install --no-cache-dir \
    -r /app/backend/requirements.txt \
    -r /app/backend/requirements-ml.txt \
    torch==2.2.0 --index-url https://download.pytorch.org/whl/cpu

# Copy backend code
COPY backend/ /app/backend/

# Create models directory and download weights
RUN mkdir -p /app/models && \
    wget -q -O /app/models/realesrgan-x4plus.pth \
    "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth" && \
    wget -q -O /app/models/realesrgan-x2plus.pth \
    "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth" && \
    wget -q -O /app/models/realesr-general-x4v3.pth \
    "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth"

ENV MODELS_DIR=/app/models
ENV PYTHONPATH=/app
EXPOSE 8000

CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
