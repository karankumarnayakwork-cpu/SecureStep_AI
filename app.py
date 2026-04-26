import os
import cv2
import json
import uuid
import tempfile
import numpy as np
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
import asyncio
import threading
from fastapi.middleware.cors import CORSMiddleware
import base64

from detection.pose_detector import PoseDetector
from detection.fall_logic import FallDetector

# ── App setup ───────────────────────────────────────────────
app = FastAPI(title="Fall Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

# ── Globals ──────────────────────────────────────────────────
# Use /tmp for HuggingFace Spaces (read-only filesystem outside /tmp)
LOG_DIR = Path(os.environ.get("LOG_DIR", "/tmp/fall_detection_logs"))
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "fall_log.json"
if not LOG_FILE.exists():
    LOG_FILE.write_text("[]")

pose_detector = PoseDetector()
webcam_fall_detector = FallDetector()   # persistent across frames

# job_id -> {"frames": [], "done": False, "falls": 0, "total": 0, ...}
video_jobs: dict = {}

# ── Helpers ──────────────────────────────────────────────────

def load_logs():
    try:
        return json.loads(LOG_FILE.read_text())
    except Exception:
        return []

def save_log(entry: dict):
    logs = load_logs()
    logs.append(entry)
    LOG_FILE.write_text(json.dumps(logs, indent=2))

def log_fall(source: str, person_id: int):
    entry = {
        "id": str(uuid.uuid4())[:8],
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "date": datetime.now().strftime("%Y-%m-%d"),
        "time": datetime.now().strftime("%H:%M:%S"),
        "source": source,
        "person_id": person_id,
        "message": f"Fall detected for Person {person_id} via {source}"
    }
    save_log(entry)
    return entry

# ── Routes ───────────────────────────────────────────────────

def _process_video_job(job_id: str, input_path: str, output_path: str, suffix: str):
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        video_jobs[job_id]["done"] = True
        return

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    video_jobs[job_id]["total"] = total

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(output_path, fourcc, fps, (w, h))

    fall_detector = FallDetector()
    fall_events = []
    frame_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame_count += 1

        results = pose_detector.detect(frame)
        annotated = results[0].plot()

        if len(results[0].boxes) > 0 and results[0].keypoints is not None:
            keypoints = results[0].keypoints.xy.cpu().numpy()
            boxes = results[0].boxes.xyxy.cpu().numpy()
            for i, (kp, box) in enumerate(zip(keypoints, boxes)):
                if fall_detector.detect_fall(kp, box, i):
                    entry = log_fall("video", i)
                    fall_events.append(entry)
                    video_jobs[job_id]["falls"] = len(fall_events)
                    cv2.putText(annotated, f"FALL DETECTED - Person {i}",
                                (int(box[0]), int(box[1]) - 10),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)

        out.write(annotated)

        # Push every 3rd frame to keep stream smooth
        if frame_count % 3 == 0:
            _, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 65])
            b64 = base64.b64encode(buf).decode("utf-8")
            video_jobs[job_id]["frames"].append({
                "b64": b64,
                "frame_num": frame_count,
                "falls": len(fall_events)
            })

    cap.release()
    out.release()
    try:
        os.unlink(input_path)
    except Exception:
        pass

    video_jobs[job_id]["output"] = Path(output_path).name
    video_jobs[job_id]["frames_processed"] = frame_count
    video_jobs[job_id]["fall_events"] = fall_events
    video_jobs[job_id]["done"] = True

@app.get("/")
async def root():
    return FileResponse("static/index.html")

@app.get("/api/logs")
async def get_logs():
    return JSONResponse(load_logs())

@app.delete("/api/logs")
async def clear_logs():
    LOG_FILE.write_text("[]")
    return {"status": "cleared"}

@app.post("/api/detect-frame")
async def detect_frame(file: UploadFile = File(...)):
    """
    Webcam: receive a single JPEG frame, run detection, return
    annotated frame as base64 + any fall events.
    """
    contents = await file.read()
    np_arr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(400, "Invalid image data")

    results = pose_detector.detect(frame)
    annotated = results[0].plot()

    falls = []
    if len(results[0].boxes) > 0 and results[0].keypoints is not None:
        keypoints = results[0].keypoints.xy.cpu().numpy()
        boxes = results[0].boxes.xyxy.cpu().numpy()
        for i, (kp, box) in enumerate(zip(keypoints, boxes)):
            if webcam_fall_detector.detect_fall(kp, box, i):
                entry = log_fall("webcam", i)
                falls.append(entry)
                cv2.putText(annotated, f"FALL P{i}", (int(box[0]), int(box[1]) - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)

    _, buffer = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
    b64 = base64.b64encode(buffer).decode("utf-8")

    return JSONResponse({"frame": b64, "falls": falls})


@app.post("/api/process-video")
async def process_video(file: UploadFile = File(...)):
    suffix = Path(file.filename).suffix or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir="/tmp") as tmp_in:
        tmp_in.write(await file.read())
        input_path = tmp_in.name

    output_path = input_path.replace(suffix, "_annotated.mp4")
    job_id = str(uuid.uuid4())[:8]

    video_jobs[job_id] = {
        "frames": [], "done": False, "falls": 0,
        "total": 0, "frames_processed": 0, "fall_events": [],
        "output": None
    }

    t = threading.Thread(
        target=_process_video_job,
        args=(job_id, input_path, output_path, suffix),
        daemon=True
    )
    t.start()

    return JSONResponse({"job_id": job_id})


@app.get("/api/stream-video/{job_id}")
async def stream_video(job_id: str):
    if job_id not in video_jobs:
        raise HTTPException(404, "Job not found")

    async def event_generator():
        sent = 0
        while True:
            job = video_jobs.get(job_id, {})
            frames = job.get("frames", [])

            while sent < len(frames):
                f = frames[sent]
                data = json.dumps({
                    "frame": f["b64"],
                    "frame_num": f["frame_num"],
                    "falls": f["falls"],
                    "total": job.get("total", 0)
                })
                yield f"data: {data}\n\n"
                sent += 1

            if job.get("done"):
                summary = json.dumps({
                    "done": True,
                    "output_video": f"/api/download/{job['output']}",
                    "frames_processed": job.get("frames_processed", 0),
                    "falls_detected": job.get("falls", 0),
                    "fall_events": job.get("fall_events", [])
                })
                yield f"data: {summary}\n\n"
                video_jobs.pop(job_id, None)
                break

            await asyncio.sleep(0.05)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )


@app.get("/api/download/{filename}")
async def download_video(filename: str):
    # Security: only allow files in /tmp
    path = Path("/tmp") / filename
    if not path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(str(path), media_type="video/mp4",
                        headers={"Content-Disposition": f"attachment; filename={filename}"})