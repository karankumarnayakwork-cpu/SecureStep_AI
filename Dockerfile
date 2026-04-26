# Hugging Face Spaces — Docker SDK
FROM python:3.10-slim

# System deps for OpenCV
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 libsm6 libxext6 libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project
COPY . .

# HF Spaces requires port 7860
EXPOSE 7860

# Pre-download YOLO model at build time to avoid cold-start delay
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n-pose.pt')"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
