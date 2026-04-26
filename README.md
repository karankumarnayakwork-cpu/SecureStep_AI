# 🎯 Secure Step AI

> **Real-time AI Fall Detection System** powered by YOLOv8 pose estimation.  
> Protecting people. Logging every event.

[![HuggingFace Space](https://img.shields.io/badge/🤗%20Live%20Demo-HuggingFace-yellow)](https://huggingface.co/spaces/Karan-25/Secure_Step_AI)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue)](https://www.python.org/)
[![YOLOv8](https://img.shields.io/badge/YOLOv8-Ultralytics-green)](https://github.com/ultralytics/ultralytics)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-teal)](https://fastapi.tiangolo.com/)

---

## 🚀 Live Demo

🔗 [https://huggingface.co/spaces/Karan-25/Secure_Step_AI](https://huggingface.co/spaces/Karan-25/Secure_Step_AI)  
🔗 [https://karan-25-secure-step-ai.hf.space/](https://karan-25-secure-step-ai.hf.space/)

---

## 📖 Overview

**Secure Step AI** detects human falls in real-time using **YOLOv8 pose estimation**. It tracks 17 body keypoints per person, computes the torso angle between shoulders and hips, and flags a fall when the body tilts beyond a threshold. Every event is timestamped and logged.

Built for elderly care, hospital monitoring, and surveillance — accessible from any browser.

---

## ✨ Features

- 🧠 **YOLOv8 Pose Estimation** — tracks 17 keypoints per person per frame
- 📐 **Angle-Based Fall Logic** — detects torso tilt > 65° from vertical
- ⏱️ **Cooldown System** — 2s per-person cooldown prevents duplicate alerts
- 🎥 **Video Upload Mode** — process any MP4/AVI/MOV, download annotated output
- 📷 **Live Webcam Mode** — streams frames to server at ~5 FPS, results shown instantly
- 📋 **Fall Event Log** — every fall stored with timestamp, source, person ID
- 🌐 **REST API** — FastAPI backend with SSE streaming for real-time video progress
- 🖥️ **Dark UI** — single-page app with tabs: Video / Camera / Logs

---

## 🛠️ Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| AI Model | YOLOv8 (Ultralytics) | 8.4.19 |
| Backend | FastAPI + Uvicorn | 0.115.0 |
| Computer Vision | OpenCV (headless) | 4.10.0.84 |
| Numerics | NumPy | 1.26.4 |
| Frontend | Vanilla JS + HTML/CSS | — |
| Deployment | HuggingFace Spaces | — |

---

## 📁 Project Structure

```
Secure_Step_AI/
├── app.py                   # FastAPI app — all API routes
├── detection/
│   ├── __init__.py
│   ├── pose_detector.py     # YOLOv8 model wrapper
│   └── fall_logic.py        # Angle-based fall detection logic
├── static/
│   ├── index.html           # Single-page frontend
│   ├── app.js               # All UI logic (tabs, camera, video, logs)
│   └── style.css            # Dark theme styling
├── logs/
│   └── fall_log.json        # Persistent fall event log
├── yolov8n-pose.pt          # YOLOv8 nano pose model weights
├── Dockerfile
├── requirements.txt
└── README.md
```

---

## ⚙️ Installation & Setup

### Prerequisites

- Python 3.8+
- Git

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/Karan-25/Secure_Step_AI.git
cd Secure_Step_AI

# 2. (Optional) Create virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the server
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000` in your browser.

> **Note:** `yolov8n-pose.pt` auto-downloads on first run if not present.

---

## 🔌 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serve frontend |
| `POST` | `/api/detect-frame` | Single webcam frame → annotated frame + fall events |
| `POST` | `/api/process-video` | Upload video → returns `job_id` |
| `GET` | `/api/stream-video/{job_id}` | SSE stream of frames + progress |
| `GET` | `/api/download/{filename}` | Download annotated video |
| `GET` | `/api/logs` | Get all fall log entries |
| `DELETE` | `/api/logs` | Clear all logs |

---

## 🧠 Fall Detection Logic

Fall detection in `detection/fall_logic.py`:

1. Extract **shoulder midpoint** and **hip midpoint** from YOLOv8 keypoints
2. Compute **torso angle** using `arctan2(|dx|, |dy|)`
3. If angle > **65°** → person is horizontal → fall state
4. **2-second cooldown** per person prevents duplicate alerts
5. Skips if keypoints are zero (person not fully visible)

```
Upright → angle ≈ 0–30°
Leaning → angle ≈ 30–65°
Fall     → angle > 65°  ← alert triggered
```

---

## 🐳 Docker / HuggingFace Spaces

Project includes a `Dockerfile` for HuggingFace Spaces deployment.  
Logs write to `/tmp/fall_detection_logs/` (HF Spaces writable path).

---

## 👤 Author

**Karan** — [Karan-25 on HuggingFace](https://huggingface.co/Karan-25)

---

## ⭐ Support

If this helped, drop a ⭐ on the repo!
