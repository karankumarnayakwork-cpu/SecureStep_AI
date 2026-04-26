/* ── State ──────────────────────────────────────────────────── */
let selectedVideoFile = null;
let cameraStream = null;
let cameraInterval = null;
let frameCount = 0;
let fallCount = 0;
let lastFrameTime = Date.now();
let fpsBuffer = [];

/* ── Tab Switching ──────────────────────────────────────────── */
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'logs') loadLogs();
}

/* ── Toast ──────────────────────────────────────────────────── */
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast'; }, 3000);
}

/* ── Status ─────────────────────────────────────────────────── */
function setStatus(text, state = '') {
  document.getElementById('statusText').textContent = text;
  const dot = document.getElementById('statusDot');
  dot.className = 'status-dot ' + state;
}

/* ── Video Upload ────────────────────────────────────────────── */
const dropZone = document.getElementById('dropZone');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('video/')) setVideoFile(file);
  else showToast('Please drop a video file', 'error');
});

function handleVideoSelect(e) {
  const file = e.target.files[0];
  if (file) setVideoFile(file);
}

function setVideoFile(file) {
  selectedVideoFile = file;
  document.getElementById('dropText').textContent = file.name;
  document.querySelector('.drop-sub').textContent = (file.size / 1024 / 1024).toFixed(1) + ' MB';
  document.getElementById('processBtn').disabled = false;
  showToast('Video loaded: ' + file.name, 'success');
}

async function processVideo() {
  if (!selectedVideoFile) return;

  const btn = document.getElementById('processBtn');
  const progressWrap = document.getElementById('progressWrap');
  const progressFill = document.getElementById('progressFill');
  const progressStatus = document.getElementById('progressStatus');
  const resultArea = document.getElementById('videoResult');
  const feed = document.getElementById('videoDetectionFeed');
  const feedOverlay = document.getElementById('videoFeedOverlay');
  const recIndicator = document.getElementById('videoRecIndicator');

  btn.disabled = true;
  progressWrap.style.display = 'block';
  progressStatus.textContent = 'Uploading...';
  setStatus('UPLOADING', 'active');
  document.getElementById('videoFrameCount').textContent = '0';
  document.getElementById('videoFallCount').textContent = '0';
  document.getElementById('videoTotalFrames').textContent = '—';

  try {
    // Step 1: Upload and get job_id
    const formData = new FormData();
    formData.append('file', selectedVideoFile);
    const uploadResp = await fetch('/api/process-video', { method: 'POST', body: formData });
    if (!uploadResp.ok) throw new Error('Upload failed');
    const { job_id } = await uploadResp.json();

    // Step 2: Open SSE stream
    progressStatus.textContent = 'Processing...';
    setStatus('PROCESSING', 'active');
    recIndicator.style.display = 'flex';
    feedOverlay.classList.add('hidden');

    const evtSource = new EventSource(`/api/stream-video/${job_id}`);

    evtSource.onmessage = (e) => {
      const msg = JSON.parse(e.data);

      if (msg.done) {
        evtSource.close();
        recIndicator.style.display = 'none';
        progressFill.style.width = '100%';
        progressStatus.textContent = 'Done!';
        setStatus('COMPLETE', 'active');

        resultArea.innerHTML = `
          <div class="result-info">
            <div class="result-row">
              <span class="result-key">STATUS</span>
              <span class="result-val good">✓ COMPLETE</span>
            </div>
            <div class="result-row">
              <span class="result-key">FRAMES PROCESSED</span>
              <span class="result-val">${msg.frames_processed}</span>
            </div>
            <div class="result-row">
              <span class="result-key">FALLS DETECTED</span>
              <span class="result-val ${msg.falls_detected > 0 ? 'danger' : 'good'}">${msg.falls_detected}</span>
            </div>
            <a href="${msg.output_video}" download
               class="btn btn-primary download-btn"
               style="margin-top:14px;text-decoration:none;display:flex;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   style="width:16px;height:16px">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              DOWNLOAD ANNOTATED VIDEO
            </a>
          </div>
        `;

        showToast(`Done! ${msg.falls_detected} fall(s) detected`,
                  msg.falls_detected > 0 ? 'error' : 'success');
        btn.disabled = false;
        updateLogBadge();
        setTimeout(() => { progressWrap.style.display = 'none'; progressFill.style.width = '0%'; }, 2000);
        return;
      }

      // Live frame update
      if (msg.frame) {
        feed.src = 'data:image/jpeg;base64,' + msg.frame;
        feed.style.display = 'block';
      }
      if (msg.frame_num !== undefined) {
        document.getElementById('videoFrameCount').textContent = msg.frame_num;
        const pct = msg.total > 0 ? Math.min((msg.frame_num / msg.total) * 100, 95) : 0;
        progressFill.style.width = pct + '%';
      }
      if (msg.total) document.getElementById('videoTotalFrames').textContent = msg.total;
      if (msg.falls !== undefined) document.getElementById('videoFallCount').textContent = msg.falls;
    };

    evtSource.onerror = () => {
      evtSource.close();
      setStatus('ERROR', 'error');
      showToast('Stream error — check server', 'error');
      btn.disabled = false;
      recIndicator.style.display = 'none';
    };

  } catch (err) {
    setStatus('ERROR', 'error');
    showToast('Error: ' + err.message, 'error');
    btn.disabled = false;
    progressStatus.textContent = 'Failed';
  }
}

/* ── Camera Feed ─────────────────────────────────────────────── */
async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    const video = document.getElementById('cameraVideo');
    video.srcObject = cameraStream;

    document.getElementById('cameraOverlay').classList.add('hidden');
    document.getElementById('detectionOverlay').classList.add('hidden');
    document.getElementById('startCamBtn').disabled = true;
    document.getElementById('stopCamBtn').disabled = false;
    document.getElementById('recIndicator').style.display = 'flex';

    setStatus('LIVE', 'recording');
    frameCount = 0; fallCount = 0;
    document.getElementById('frameCount').textContent = '0';
    document.getElementById('fallCount').textContent = '0';
    document.getElementById('fpsDisplay').textContent = '0';

    // Send frames every 200ms (~5fps to keep server happy)
    cameraInterval = setInterval(sendFrame, 200);

  } catch (err) {
    showToast('Camera error: ' + err.message, 'error');
    setStatus('ERROR', 'error');
  }
}

function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  if (cameraInterval) { clearInterval(cameraInterval); cameraInterval = null; }

  const video = document.getElementById('cameraVideo');
  video.srcObject = null;

  document.getElementById('cameraOverlay').classList.remove('hidden');
  document.getElementById('startCamBtn').disabled = false;
  document.getElementById('stopCamBtn').disabled = true;
  document.getElementById('recIndicator').style.display = 'none';

  setStatus('IDLE', '');
  showToast('Camera stopped', '');
}

async function sendFrame() {
  const video = document.getElementById('cameraVideo');
  if (!video.videoWidth) return;

  const canvas = document.getElementById('cameraCanvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  canvas.toBlob(async (blob) => {
    if (!blob) return;

    // FPS calc
    const now = Date.now();
    const delta = now - lastFrameTime;
    lastFrameTime = now;
    fpsBuffer.push(1000 / delta);
    if (fpsBuffer.length > 10) fpsBuffer.shift();
    const fps = Math.round(fpsBuffer.reduce((a, b) => a + b) / fpsBuffer.length);

    const formData = new FormData();
    formData.append('file', blob, 'frame.jpg');

    try {
      const resp = await fetch('/api/detect-frame', { method: 'POST', body: formData });
      if (!resp.ok) return;
      const data = await resp.json();

      // Show annotated frame
      const feed = document.getElementById('detectionFeed');
      feed.src = 'data:image/jpeg;base64,' + data.frame;
      feed.style.display = 'block';

      frameCount++;
      document.getElementById('frameCount').textContent = frameCount;
      document.getElementById('fpsDisplay').textContent = fps;

      if (data.falls && data.falls.length > 0) {
        fallCount += data.falls.length;
        document.getElementById('fallCount').textContent = fallCount;
        showToast(`⚠ FALL DETECTED — Person ${data.falls[0].person_id}`, 'error');
        updateLogBadge();
      }

    } catch (e) { /* ignore frame errors */ }
  }, 'image/jpeg', 0.7);
}

/* ── Logs ────────────────────────────────────────────────────── */
async function loadLogs() {
  try {
    const resp = await fetch('/api/logs');
    const logs = await resp.json();
    renderLogs(logs);
  } catch (e) {
    showToast('Failed to load logs', 'error');
  }
}

function renderLogs(logs) {
  const tbody = document.getElementById('logTableBody');
  const today = new Date().toISOString().slice(0, 10);

  const total = logs.length;
  const todayCount = logs.filter(l => l.date === today).length;
  const videoCount = logs.filter(l => l.source === 'video').length;
  const camCount   = logs.filter(l => l.source === 'webcam').length;

  document.getElementById('totalFalls').textContent = total;
  document.getElementById('todayFalls').textContent = todayCount;
  document.getElementById('videoFalls').textContent = videoCount;
  document.getElementById('camFalls').textContent   = camCount;
  document.getElementById('logBadge').textContent   = total;

  if (logs.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No fall events recorded</td></tr>';
    return;
  }

  tbody.innerHTML = logs.slice().reverse().map(l => `
    <tr>
      <td>#${l.id}</td>
      <td>${l.date}</td>
      <td>${l.time}</td>
      <td><span class="source-badge ${l.source}">${l.source.toUpperCase()}</span></td>
      <td>P${l.person_id}</td>
      <td>${l.message}</td>
    </tr>
  `).join('');
}

async function clearLogs() {
  if (!confirm('Clear all fall logs?')) return;
  await fetch('/api/logs', { method: 'DELETE' });
  await loadLogs();
  showToast('Logs cleared', '');
  document.getElementById('logBadge').textContent = '0';
}

async function updateLogBadge() {
  try {
    const resp = await fetch('/api/logs');
    const logs = await resp.json();
    document.getElementById('logBadge').textContent = logs.length;
  } catch (e) {}
}

/* ── Launch ──────────────────────────────────────────────────── */
function launchApp() {
  document.getElementById('page-landing').style.display = 'none';
  document.getElementById('page-app').style.display = 'block';
  window.scrollTo(0, 0);
  // ensure video tab active
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-tab="video"]').classList.add('active');
  document.getElementById('tab-video').classList.add('active');
}

function goHome() {
  document.getElementById('page-app').style.display = 'none';
  document.getElementById('page-landing').style.display = 'block';
  window.scrollTo(0, 0);
}

/* ── Init ────────────────────────────────────────────────────── */
updateLogBadge();