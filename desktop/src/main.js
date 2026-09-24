import { Command } from '@tauri-apps/plugin-shell';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import './styles.css';

const status = document.querySelector('#status');
const recordStatus = document.querySelector('#recordStatus');
const assetStatus = document.querySelector('#assetStatus');
const processStatus = document.querySelector('#processStatus');
const assetImportButton = document.querySelector('#importAudio');
const audioFileInput = document.querySelector('#audioFile');
const transcribeButton = document.querySelector('#transcribe');
const systemAudioButton = document.querySelector('#systemAudioRecord');
const systemAudioStatus = document.querySelector('#systemAudioStatus');
const systemAudioLabel = systemAudioButton.querySelector('span:not(.windows-only)');
const recordLabel = document.querySelector('.record-label');
const retryUploadButton = document.querySelector('#retryUpload');
const profileSelect = document.querySelector('#profile');
const profileSummary = document.querySelector('#profileSummary');
let nodeProcess;
let nodeStartPromise;
let nodeStartupFailure = null;
let appIsClosing = false;
let closeCleanupStarted = false;
const apiUrl = 'http://127.0.0.1:8765';
let currentAsset;
let lastCompletedJob;
let pendingUpload;

for (const id of ['vaultPath', 'whisperPath', 'modelPath', 'ffmpegPath', 'ollamaModel']) {
  document.querySelector(`#${id}`).value = localStorage.getItem(`voice-memory.${id}`) || '';
  document.querySelector(`#${id}`).addEventListener('change', (event) => localStorage.setItem(`voice-memory.${id}`, event.target.value));
}
const ollamaEndpoint = document.querySelector('#ollamaEndpoint');
ollamaEndpoint.value = localStorage.getItem('voice-memory.ollamaEndpoint') || 'http://127.0.0.1:11434';
ollamaEndpoint.addEventListener('change', () => localStorage.setItem('voice-memory.ollamaEndpoint', ollamaEndpoint.value));
profileSelect.addEventListener('change', () => {
  profileSummary.textContent = profileSelect.selectedOptions[0]?.textContent || '自定义';
});
document.querySelector('#todayDate').textContent = new Intl.DateTimeFormat('zh-CN', {dateStyle:'medium'}).format(new Date()).toUpperCase();

function refreshActions() {
  const missing = [];
  if (!currentAsset) missing.push('先录音或导入音频');
  else {
    if (!document.querySelector('#vaultPath').value.trim()) missing.push('选择 Obsidian Vault');
    if (!document.querySelector('#whisperPath').value.trim()) missing.push('选择 whisper.cpp 程序');
    if (!document.querySelector('#modelPath').value.trim()) missing.push('选择 Whisper 模型');
  }
  const ready = missing.length === 0;
  transcribeButton.disabled = !ready;
  if (!ready) processStatus.textContent = `还需：${missing.join(' · ')}`;
}

function localTimestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

for (const id of ['vaultPath', 'whisperPath', 'modelPath', 'ffmpegPath']) document.querySelector(`#${id}`).addEventListener('input', refreshActions);

async function choosePath(buttonId, inputId, options) {
  document.querySelector(`#${buttonId}`).addEventListener('click', async () => {
    try {
      const result = await open(options);
      if (result && typeof result === 'string') {
        const input = document.querySelector(`#${inputId}`);
        input.value = result;
        input.dispatchEvent(new Event('change'));
        input.dispatchEvent(new Event('input'));
      }
    } catch (error) {
      processStatus.textContent = `无法打开系统文件选择器：${error.message}`;
    }
  });
}

choosePath('chooseVault', 'vaultPath', {directory:true, multiple:false, title:'选择 Obsidian Vault'});
choosePath('chooseWhisper', 'whisperPath', {directory:false, multiple:false, title:'选择 whisper.cpp 程序', filters:[{name:'程序', extensions:['exe','app','bin','command']}]});
choosePath('chooseModel', 'modelPath', {directory:false, multiple:false, title:'选择 Whisper 模型', filters:[{name:'Whisper 模型', extensions:['bin','gguf']}]});
choosePath('chooseFfmpeg', 'ffmpegPath', {directory:false, multiple:false, title:'选择 FFmpeg 程序', filters:[{name:'FFmpeg', extensions:['exe','bin','command']}]});

async function uploadAudio(blob, name, source = 'loopback-upload') {
  assetStatus.textContent = '正在写入本地音频账本…';
  let response;
  try {
    response = await fetch(`${apiUrl}/ledger/upload`, {
      method:'POST',
      headers:{'Content-Type':'application/octet-stream', 'X-File-Name':encodeURIComponent(name), 'X-Audio-Source':source},
      body:blob,
    });
  } catch (error) {
    throw new Error(`无法连接本机音频服务（${error.message}）。音频暂存在本次会话中，恢复服务后可重试保存。`);
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  if (currentAsset?.id !== result.id) lastCompletedJob = null;
  currentAsset = result;
  assetStatus.textContent = `已保存：${result.original_name} · ${result.size_bytes} bytes · SHA-256 ${result.sha256.slice(0, 12)}…`;
  refreshActions();
  return result;
}

async function saveAudio(blob, name, source) {
  pendingUpload = {blob, name, source};
  retryUploadButton.hidden = false;
  try {
    const asset = await uploadAudio(blob, name, source);
    pendingUpload = null;
    retryUploadButton.hidden = true;
    return asset;
  } catch (error) {
    assetStatus.textContent = error.message;
    throw error;
  }
}

retryUploadButton.addEventListener('click', async () => {
  if (!pendingUpload) return;
  retryUploadButton.disabled = true;
  retryUploadButton.textContent = '正在重试…';
  const pending = pendingUpload;
  try {
    await saveAudio(pending.blob, pending.name, pending.source);
    if (pending.source === 'microphone-capture') recordStatus.textContent = '录音已写入本地音频账本';
  } catch {}
  finally {
    retryUploadButton.disabled = false;
    retryUploadButton.textContent = '重试保存';
  }
});

function selectAudioFile(event) {
  assetImportButton.disabled = !event.target.files?.length;
  currentAsset = null;
  lastCompletedJob = null;
  assetStatus.textContent = event.target.files?.length ? '已选择文件，点击“导入账本”' : '尚未选择音频';
  refreshActions();
  const file = event.target.files?.[0];
  const fileName = document.querySelector('.drop-copy strong');
  const fileHint = document.querySelector('.drop-copy small');
  fileName.textContent = file?.name || '选择音频文件';
  fileHint.textContent = file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · 准备写入本机` : 'WAV · MP3 · M4A · FLAC · 以及更多';
  if (file && !document.querySelector('#recordTitle').value) {
    document.querySelector('#recordTitle').value = file.name.replace(/\.[^.]+$/, '');
  }
}

audioFileInput.addEventListener('change', selectAudioFile);
const dropzone = document.querySelector('.dropzone');
for (const name of ['dragenter', 'dragover']) dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  dropzone.classList.add('dragging');
});
for (const name of ['dragleave', 'drop']) dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragging');
});
dropzone.addEventListener('drop', (event) => {
  const file = [...(event.dataTransfer?.files || [])].find(item => item.type.startsWith('audio/') || /\.(m4a|mp3|wav|flac|ogg|webm)$/i.test(item.name));
  if (!file) {
    assetStatus.textContent = '请拖入受支持的音频文件';
    return;
  }
  const transfer = new DataTransfer();
  transfer.items.add(file);
  audioFileInput.files = transfer.files;
  audioFileInput.dispatchEvent(new Event('change', {bubbles:true}));
});

assetImportButton.addEventListener('click', async () => {
  const file = audioFileInput.files?.[0];
  if (!file) return;
  assetImportButton.disabled = true;
  try { await saveAudio(file, file.name, 'file-import'); processStatus.textContent = '音频已导入，配置转写后即可生成记录'; }
  catch (error) { assetStatus.textContent = `导入失败：${error.message}`; }
  finally { assetImportButton.disabled = false; }
});

async function startNode() {
  if (nodeProcess) return nodeProcess;
  if (nodeStartPromise) return nodeStartPromise;
  nodeStartPromise = (async () => {
    const args = ['serve'];
    if (navigator.userAgent.includes('Mac')) {
      args.push('--parent-pid', String(await invoke('desktop_process_id')));
    }
    const command = Command.sidecar('binaries/voice-memory-node', args);
    command.on('close', (event) => {
      nodeProcess = null;
      if (!appIsClosing) {
        nodeStartupFailure = `退出代码 ${event.code ?? '未知'}`;
        status.className = 'warn';
        status.textContent = `本地处理节点已退出（${nodeStartupFailure}），可点击重新检查启动`;
      }
    });
    command.on('error', (error) => {
      nodeStartupFailure = String(error);
      status.className = 'warn';
      status.textContent = `本地处理节点启动失败：${error}`;
    });
    nodeProcess = await command.spawn();
    nodeStartupFailure = null;
    if (navigator.userAgent.includes('Mac')) await invoke('register_sidecar_pid', {pid: nodeProcess.pid});
    return nodeProcess;
  })();
  try {
    return await nodeStartPromise;
  } catch (error) {
    nodeProcess = null;
    nodeStartupFailure = error instanceof Error ? error.message : String(error);
    console.info('sidecar unavailable in browser/dev mode', error);
    throw error;
  } finally {
    nodeStartPromise = null;
  }
}

// Windows owns the complete process tree in a native Job Object. Its cleanup
// also works when the webview is unavailable or the desktop is forcibly killed.
async function stopNodeForExit() {
  if (nodeStartPromise) {
    try { await nodeStartPromise; } catch { /* nothing to stop */ }
  }
  const child = nodeProcess;
  nodeProcess = null;
  if (child) {
    try {
      if (navigator.userAgent.includes('Mac')) await invoke('terminate_sidecar_tree', {rootPid: child.pid});
      else await child.kill();
      if (navigator.userAgent.includes('Mac')) await invoke('clear_sidecar_pid');
    }
    catch (error) {
      nodeProcess = child;
      appIsClosing = false;
      closeCleanupStarted = false;
      status.textContent = `本地处理节点关闭失败：${error}`;
      throw error;
    }
  }
}

let desktopStartReady = Promise.resolve();
if (isTauri() && !navigator.userAgent.includes('Windows')) {
  const closeRequestedReady = getCurrentWindow().onCloseRequested(async (event) => {
    if (!nodeProcess && !nodeStartPromise && !navigator.userAgent.includes('Mac')) return;
    event.preventDefault();
    if (closeCleanupStarted) return;
    closeCleanupStarted = true;
    appIsClosing = true;
    try {
      await stopNodeForExit();
      if (navigator.userAgent.includes('Mac')) await invoke('approve_app_exit');
      else await getCurrentWindow().destroy();
    } catch (error) {
      appIsClosing = false;
      closeCleanupStarted = false;
      status.textContent = `本地处理节点关闭失败：${error}`;
    }
  });

  const appQuitReady = listen('voice-memory://quit-requested', async () => {
    if (closeCleanupStarted) return;
    closeCleanupStarted = true;
    appIsClosing = true;
    try {
      await stopNodeForExit();
      await invoke('approve_app_exit');
    } catch (error) {
      appIsClosing = false;
      closeCleanupStarted = false;
      status.textContent = `本地处理节点关闭失败：${error}`;
    }
  });
  desktopStartReady = Promise.all([closeRequestedReady, appQuitReady]).then(async () => {
    if (navigator.userAgent.includes('Mac')) await invoke('mark_ui_ready');
  });
  desktopStartReady.catch((error) => console.warn('could not register app quit handlers', error));
}

async function check() {
  status.className = '';
  status.textContent = '检查中…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${apiUrl}/health`, {signal: controller.signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    status.className = 'ok';
    status.textContent = '本地处理节点正常';
    return true;
  } catch (error) {
    status.className = 'warn';
    status.textContent = nodeStartupFailure
      ? `本地处理节点启动失败：${nodeStartupFailure}`
      : isTauri()
      ? '本地处理节点尚未就绪，请点击“重新检查”重试'
      : '本地处理节点未启动，请先运行 voice-memory serve';
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForNode() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

document.querySelector('#retry').addEventListener('click', async () => {
  try { await startNode(); } catch {}
  await waitForNode();
});
let recorder;
let chunks = [];
const nativeMacMicrophone = isTauri() && navigator.userAgent.includes('Mac');
let nativeMicRecording = false;
let systemAudioRecording = false;
if (!navigator.userAgent.includes('Windows')) {
  systemAudioButton.hidden = true;
  systemAudioStatus.hidden = true;
}

systemAudioButton.addEventListener('click', async () => {
  systemAudioButton.disabled = true;
  try {
    if (!systemAudioRecording) {
      const recoveryPath = await invoke('start_system_audio_capture');
      systemAudioRecording = true;
      systemAudioLabel.textContent = '停止并保存';
      systemAudioStatus.textContent = `正在本机捕获系统播放声音；麦克风录音可同时进行。临时录音文件：${recoveryPath}`;
      return;
    }
    systemAudioRecording = false;
    systemAudioLabel.textContent = '录制系统声音';
    const asset = await invoke('stop_system_audio_capture');
    if (currentAsset?.id !== asset.id) lastCompletedJob = null;
    currentAsset = asset;
    assetStatus.textContent = `已保存系统音频：${asset.original_name} · ${asset.size_bytes} bytes · SHA-256 ${asset.sha256.slice(0, 12)}…`;
    systemAudioStatus.textContent = '系统音频已写入本地音频账本。';
    refreshActions();
    if (!document.querySelector('#recordTitle').value) document.querySelector('#recordTitle').value = `系统录音 ${localTimestamp()}`;
  } catch (error) {
    if (systemAudioRecording) systemAudioRecording = false;
    systemAudioLabel.textContent = '录制系统声音';
    systemAudioStatus.textContent = `系统音频录制失败：${error.message || error}`;
  } finally {
    systemAudioButton.disabled = false;
  }
});

document.querySelector('#record').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (nativeMacMicrophone) {
    button.disabled = true;
    try {
      if (!nativeMicRecording) {
        const recoveryPath = await invoke('start_microphone_capture');
        nativeMicRecording = true;
        recordLabel.textContent = '停止并保存录音';
        recordStatus.textContent = `正在本机录音。临时文件可在应用异常退出后恢复：${recoveryPath}`;
        return;
      }
      const asset = await invoke('stop_microphone_capture');
      nativeMicRecording = false;
      if (currentAsset?.id !== asset.id) lastCompletedJob = null;
      currentAsset = asset;
      assetStatus.textContent = `已保存麦克风录音：${asset.original_name} · ${asset.size_bytes} bytes · SHA-256 ${asset.sha256.slice(0, 12)}…`;
      recordStatus.textContent = '录音已写入本地音频账本';
      recordLabel.textContent = '开始麦克风录音';
      if (!document.querySelector('#recordTitle').value) document.querySelector('#recordTitle').value = `录音 ${localTimestamp()}`;
      refreshActions();
    } catch (error) {
      if (nativeMicRecording) {
        nativeMicRecording = false;
        recordLabel.textContent = '开始麦克风录音';
      }
      recordStatus.textContent = `麦克风录音失败：${error.message || error}`;
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (recorder?.state === 'recording') { recorder.stop(); recordLabel.textContent = '开始麦克风录音'; return; }
  try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
    recorder = new MediaRecorder(stream); chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, {type: recorder.mimeType || 'audio/webm'});
      try {
        const mimeSubtype = (recorder.mimeType || blob.type || 'audio/webm').split('/')[1]?.split(';')[0]?.toLowerCase() || 'webm';
        const extension = ({'mp4':'m4a', 'x-wav':'wav'})[mimeSubtype] || mimeSubtype;
        await saveAudio(blob, `microphone-${Date.now()}.${extension}`, 'microphone-capture');
        recordStatus.textContent = '录音已写入本地音频账本';
        if (!document.querySelector('#recordTitle').value) document.querySelector('#recordTitle').value = `录音 ${localTimestamp()}`;
      } catch (error) { recordStatus.textContent = `写入失败：${error.message}`; }
    };
    recorder.start(); recordLabel.textContent = '停止并保存录音'; recordStatus.textContent = '录音中（仅麦克风）';
  } catch (error) { recordStatus.textContent = `无法访问麦克风：${error.message}`; }
});

let reviewRecord;
let reviewHistory = [];
let reviewPlaybackEnd = null;
const reviewStatus = document.querySelector('#reviewStatus');
const reviewSegments = document.querySelector('#reviewSegments');
const reviewTimeline = document.querySelector('#reviewTimeline');
const reviewRuler = document.querySelector('#reviewRuler');
const reviewTracks = document.querySelector('#reviewTracks');
const saveReview = document.querySelector('#saveReview');
const reanalyzeButton = document.querySelector('#reanalyze');
const reviewAudio = document.querySelector('#reviewAudio');
const undoReview = document.querySelector('#undoReview');
const redoReview = document.querySelector('#redoReview');
const mergeSelected = document.querySelector('#mergeSelected');
const reviewSelectionCount = document.querySelector('#reviewSelectionCount');

function syncReviewHistoryControls() {
  undoReview.disabled = !reviewHistory.some(item => (item.kind || 'change') === 'change' && item.active !== false);
  redoReview.disabled = !reviewHistory.some(item => item.kind === 'undo' && !item.redone && !item.abandoned);
}

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function reviewDuration() {
  const mediaDuration = Number.isFinite(reviewAudio.duration) ? reviewAudio.duration : 0;
  const segmentEnd = Math.max(0, ...(reviewRecord?.segments || []).map(segment => segment.end));
  return Math.max(mediaDuration, segmentEnd, 0.1);
}

function updateTimelinePlayhead() {
  for (const track of reviewTracks.querySelectorAll('.timeline-track')) {
    let playhead = track.querySelector('.timeline-playhead');
    if (!playhead) { playhead = document.createElement('span'); playhead.className = 'timeline-playhead'; track.append(playhead); }
    playhead.style.left = `${Math.min(100, Math.max(0, reviewAudio.currentTime / reviewDuration() * 100))}%`;
  }
  if (reviewPlaybackEnd !== null && reviewAudio.currentTime >= reviewPlaybackEnd) {
    reviewAudio.pause();
    reviewPlaybackEnd = null;
  }
}

async function seekAndPlay(start, end = null) {
  if (!reviewRecord?.audio_asset_id) { reviewStatus.textContent = '此记录未关联本地音频资产'; return; }
  reviewPlaybackEnd = end;
  try {
    if (reviewAudio.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise((resolve, reject) => {
        reviewAudio.addEventListener('loadedmetadata', resolve, {once:true});
        reviewAudio.addEventListener('error', () => reject(new Error('音频无法读取')), {once:true});
      });
    }
    reviewAudio.currentTime = Math.min(start, Math.max(0, reviewAudio.duration - 0.05));
    await reviewAudio.play();
  } catch (error) { reviewPlaybackEnd = null; reviewStatus.textContent = `无法播放：${error.message}`; }
}

function renderTimeline() {
  if (!reviewRecord?.audio_asset_id) {
    reviewAudio.hidden = true;
    reviewTimeline.hidden = true;
    return;
  }
  reviewAudio.hidden = false;
  const source = `${apiUrl}/ledger/${encodeURIComponent(reviewRecord.audio_asset_id)}/content`;
  if (reviewAudio.dataset.assetId !== reviewRecord.audio_asset_id) {
    reviewAudio.dataset.assetId = reviewRecord.audio_asset_id;
    reviewAudio.src = source;
    reviewAudio.load();
  }
  reviewTimeline.hidden = false;
  const duration = reviewDuration();
  reviewRuler.replaceChildren();
  for (let tick = 0; tick <= 4; tick += 1) {
    const label = document.createElement('span');
    label.textContent = formatTime(duration * tick / 4);
    reviewRuler.append(label);
  }
  reviewTracks.replaceChildren();
  const speakers = [...new Set((reviewRecord.segments || []).map(segment => segment.speaker || '未知说话人'))];
  for (const speakerName of speakers) {
    const lane = document.createElement('div'); lane.className = 'timeline-lane';
    const speaker = document.createElement('span'); speaker.className = 'timeline-speaker'; speaker.textContent = speakerName;
    const track = document.createElement('div'); track.className = 'timeline-track';
    for (const segment of reviewRecord.segments.filter(item => (item.speaker || '未知说话人') === speakerName)) {
      const block = document.createElement('button');
      block.type = 'button';
      block.className = `timeline-segment ${segment.speaker_status || 'unknown'}${segment.unclear ? ' unclear' : ''}`;
      block.style.left = `${Math.max(0, segment.start / duration * 100)}%`;
      block.style.width = `${Math.max(0.7, (segment.end - segment.start) / duration * 100)}%`;
      block.textContent = segment.text.slice(0, 28) || '片段';
      block.title = `${formatTime(segment.start)}–${formatTime(segment.end)} · ${speakerName}${segment.overlap ? ' · 重叠发言' : ''}`;
      block.setAttribute('aria-label', `播放 ${speakerName}，${formatTime(segment.start)} 到 ${formatTime(segment.end)}`);
      block.addEventListener('click', () => seekAndPlay(segment.start, segment.end));
      track.append(block);
    }
    lane.append(speaker, track); reviewTracks.append(lane);
  }
  updateTimelinePlayhead();
}

reviewAudio.addEventListener('loadedmetadata', renderTimeline);
reviewAudio.addEventListener('timeupdate', updateTimelinePlayhead);
reviewAudio.addEventListener('play', updateTimelinePlayhead);

function reviewBadge(status) {
  const badge = document.createElement('span');
  badge.className = `badge ${status || 'unknown'}`;
  badge.textContent = status === 'confirmed' ? '已确认' : status === 'suggestion' ? '建议' : '未知';
  return badge;
}

function renderReview(record) {
  reviewSegments.replaceChildren();
  for (const segment of record.segments || []) {
    const article = document.createElement('article');
    article.className = 'review-segment';
    article.dataset.segmentId = segment.id;
    const meta = document.createElement('div');
    meta.className = 'review-meta';
    const selected = document.createElement('input');
    selected.type = 'checkbox'; selected.className = 'segment-select'; selected.setAttribute('aria-label', '选择此片段以合并');
    selected.addEventListener('change', updateMergeSelection);
    const time = document.createElement('div'); time.className = 'segment-time';
    const start = document.createElement('input'); start.type = 'number'; start.min = '0'; start.step = '0.01'; start.value = segment.start.toFixed(2); start.dataset.initialValue = start.value; start.setAttribute('aria-label', '片段开始时间（秒）');
    const separator = document.createElement('span'); separator.textContent = '至';
    const end = document.createElement('input'); end.type = 'number'; end.min = '0'; end.step = '0.01'; end.value = segment.end.toFixed(2); end.dataset.initialValue = end.value; end.setAttribute('aria-label', '片段结束时间（秒）');
    time.append(start, separator, end);
    const segmentId = document.createElement('span'); segmentId.className = 'badge'; segmentId.textContent = segment.id;
    meta.append(selected, time, reviewBadge(segment.speaker_status), segmentId);
    const speaker = document.createElement('input');
    speaker.value = segment.speaker;
    speaker.setAttribute('aria-label', '说话人');
    const state = document.createElement('select');
    for (const value of ['unknown', 'suggestion', 'confirmed']) {
      const option = document.createElement('option'); option.value = value; option.textContent = value === 'confirmed' ? '已确认' : value === 'suggestion' ? '建议' : '未知';
      if (value === (segment.speaker_status || 'unknown')) option.selected = true;
      state.append(option);
    }
    meta.append(speaker, state);
    const text = document.createElement('textarea');
    text.value = segment.text;
    text.setAttribute('aria-label', '转写文本');
    const flags = document.createElement('label');
    const overlap = document.createElement('input'); overlap.type = 'checkbox'; overlap.checked = Boolean(segment.overlap); overlap.style.width = 'auto';
    const overlapText = document.createTextNode(' 重叠发言 ');
    const unclear = document.createElement('input'); unclear.type = 'checkbox'; unclear.checked = Boolean(segment.unclear); unclear.style.width = 'auto';
    flags.append(overlap, overlapText, unclear, document.createTextNode(' 不清楚'));
    const controls = document.createElement('div'); controls.className = 'review-controls';
    const play = document.createElement('button'); play.type = 'button'; play.className = 'button button-outline'; play.textContent = '播放此段';
    play.addEventListener('click', () => seekAndPlay(segment.start, segment.end));
    const split = document.createElement('button'); split.type = 'button'; split.className = 'button button-outline'; split.textContent = '在光标处拆分';
    split.addEventListener('click', async () => {
      const cursor = text.selectionStart;
      const leftText = text.value.slice(0, cursor).trim();
      const rightText = text.value.slice(cursor).trim();
      if (!leftText || !rightText) { reviewStatus.textContent = '请先把光标放到要拆分的位置，两侧都需要有文字'; text.focus(); return; }
      const splitAt = Math.round((segment.start + (segment.end - segment.start) * cursor / Math.max(1, text.value.length)) * 100) / 100;
      await postReviewCorrection({type:'split', segment_id:segment.id, split_at:splitAt, left_text:leftText, right_text:rightText}, '片段已拆分');
    });
    const saveTiming = document.createElement('button'); saveTiming.type = 'button'; saveTiming.className = 'button button-outline'; saveTiming.textContent = '保存时间';
    saveTiming.addEventListener('click', async () => {
      if (start.value === start.dataset.initialValue && end.value === end.dataset.initialValue) return;
      await postReviewCorrection({type:'edit_timing', segment_id:segment.id, start:Number(start.value), end:Number(end.value)}, '时间范围已更新');
    });
    const flagsLabel = document.createElement('span'); flagsLabel.className = 'review-flags'; flagsLabel.append(flags);
    controls.append(play, split, saveTiming, flagsLabel);
    article.append(meta, text, controls);
    reviewSegments.append(article);
  }
  saveReview.disabled = false;
  reanalyzeButton.disabled = !document.querySelector('#ollamaModel').value.trim();
  renderTimeline();
  syncReviewHistoryControls();
  updateMergeSelection();
}

function selectedReviewSegments() {
  return [...reviewSegments.querySelectorAll('.review-segment')]
    .filter(article => article.querySelector('.segment-select').checked)
    .map(article => article.dataset.segmentId);
}

function updateMergeSelection() {
  const ids = selectedReviewSegments();
  mergeSelected.disabled = ids.length !== 2;
  reviewSelectionCount.textContent = ids.length
    ? `已选择 ${ids.length} 段；只能合并相邻且说话人相同的片段`
    : '选择两个相邻、同一说话人的片段进行合并';
}

function hasPendingReviewEdits({ignoreText = false} = {}) {
  if (!reviewRecord) return false;
  return [...reviewSegments.querySelectorAll('.review-segment')].some(article => {
    const original = reviewRecord.segments.find(item => item.id === article.dataset.segmentId);
    if (!original) return false;
    const flags = article.querySelectorAll('.review-flags input[type="checkbox"]');
    return (!ignoreText && article.querySelector('textarea').value.trim() !== original.text)
      || article.querySelector('input[aria-label="说话人"]').value.trim() !== original.speaker
      || article.querySelector('select').value !== (original.speaker_status || 'unknown')
      || article.querySelector('[aria-label="片段开始时间（秒）"]').value !== article.querySelector('[aria-label="片段开始时间（秒）"]').dataset.initialValue
      || article.querySelector('[aria-label="片段结束时间（秒）"]').value !== article.querySelector('[aria-label="片段结束时间（秒）"]').dataset.initialValue
      || flags[0].checked !== Boolean(original.overlap)
      || flags[1].checked !== Boolean(original.unclear);
  });
}

async function postReviewCorrection(operation, successMessage) {
  if (!reviewRecord) return;
  if (hasPendingReviewEdits({ignoreText:operation.type === 'split'})) {
    reviewStatus.textContent = '请先保存当前说话人、标记或时间修改，再执行此操作';
    return;
  }
  try {
    const response = await fetch(`${apiUrl}/records/${encodeURIComponent(reviewRecord.id)}/corrections`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(operation),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    reviewRecord = result.record;
    reviewHistory = result.correction_history || reviewHistory;
    renderReview(reviewRecord);
    reviewStatus.textContent = successMessage;
  } catch (error) { reviewStatus.textContent = `修改失败：${error.message}`; }
}

document.querySelector('#loadReview').addEventListener('click', async () => {
  const id = document.querySelector('#reviewRecordId').value.trim();
  if (!id) { reviewStatus.textContent = '请先输入记录 ID'; return; }
  try {
    const response = await fetch(`${apiUrl}/records/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const sidecar = await response.json();
    reviewRecord = sidecar.record;
    reviewHistory = sidecar.correction_history || [];
    document.querySelector('#profile').value = reviewRecord.primary_mode;
    renderReview(reviewRecord);
    reviewStatus.textContent = `已加载 ${reviewRecord.title}，历史修正 ${sidecar.correction_history?.length || 0} 次`;
  } catch (error) { reviewStatus.textContent = `加载失败：${error.message}`; reviewSegments.replaceChildren(); reviewTimeline.hidden = true; reviewAudio.hidden = true; saveReview.disabled = true; reviewHistory = []; syncReviewHistoryControls(); }
});

undoReview.addEventListener('click', () => postReviewCorrection({type:'undo'}, '已撤销最近一次复核修改'));
redoReview.addEventListener('click', () => postReviewCorrection({type:'redo'}, '已重做复核修改'));
mergeSelected.addEventListener('click', async () => {
  const ids = selectedReviewSegments();
  if (ids.length !== 2) return;
  await postReviewCorrection({type:'merge', segment_ids:ids}, '选中的相邻片段已合并');
});

document.querySelector('#ollamaModel').addEventListener('input', () => {
  reanalyzeButton.disabled = !reviewRecord || !document.querySelector('#ollamaModel').value.trim();
});

reanalyzeButton.addEventListener('click', async () => {
  if (!reviewRecord) return;
  const selectedProfile = document.querySelector('#profile').value;
  const selectedProfileName = document.querySelector('#profile').selectedOptions[0]?.textContent || selectedProfile;
  reanalyzeButton.disabled = true;
  reviewStatus.textContent = '正在本机重新整理当前已校正转写…';
  try {
    const response = await fetch(`${apiUrl}/records/${encodeURIComponent(reviewRecord.id)}/reprocess`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({primary_mode:document.querySelector('#profile').value, processor_endpoint:ollamaEndpoint.value.trim(), processor_model:document.querySelector('#ollamaModel').value.trim()}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    const refreshed = await fetch(`${apiUrl}/records/${encodeURIComponent(reviewRecord.id)}`);
    if (!refreshed.ok) throw new Error(`刷新记录失败：HTTP ${refreshed.status}`);
    const sidecar = await refreshed.json();
    reviewRecord = sidecar.record;
    document.querySelector('#profile').value = selectedProfile;
    renderReview(reviewRecord);
    reviewStatus.textContent = `已生成“${selectedProfileName}”处理视角：${result.view_path}；结果仍需逐条核验。`;
  } catch (error) {
    reviewStatus.textContent = `重新整理失败：${error.message}`;
    reanalyzeButton.disabled = !reviewRecord || !document.querySelector('#ollamaModel').value.trim();
  }
});

transcribeButton.addEventListener('click', async () => {
  if (!currentAsset) return;
  const title = document.querySelector('#recordTitle').value.trim();
  if (!title) { processStatus.textContent = '请填写记录标题'; return; }
  transcribeButton.disabled = true;
  try {
    let job = lastCompletedJob?.assetId === currentAsset.id ? lastCompletedJob : null;
    if (!job) {
      processStatus.textContent = '已加入本地转写队列…';
      const response = await fetch(`${apiUrl}/transcribe`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({asset_id:currentAsset.id, provider:'whisper.cpp', executable:document.querySelector('#whisperPath').value.trim(), model:document.querySelector('#modelPath').value.trim(), ffmpeg_executable:document.querySelector('#ffmpegPath').value.trim() || 'ffmpeg'}),
      });
      job = await response.json();
      if (!response.ok) throw new Error(job.error || `HTTP ${response.status}`);
      let current;
      do {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const poll = await fetch(`${apiUrl}/jobs/${encodeURIComponent(job.id)}`);
        current = await poll.json();
        if (!poll.ok) throw new Error(current.error || `HTTP ${poll.status}`);
        processStatus.textContent = current.status === 'running' ? '正在本机转写，请稍候…' : '转写任务已排队…';
      } while (current.status === 'queued' || current.status === 'running');
      if (current.status !== 'completed') throw new Error(current.error || '本地转写失败');
      lastCompletedJob = {id: job.id, assetId: currentAsset.id};
    }
    const semanticModel = document.querySelector('#ollamaModel').value.trim();
    processStatus.textContent = semanticModel ? '转写完成，正在调用本机模型整理并校验证据…' : '转写完成，正在生成原文与证据索引（未配置语义模型）…';
    const compile = await fetch(`${apiUrl}/records/from-job`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({job_id:job.id, asset_id:currentAsset.id, title, primary_mode:document.querySelector('#profile').value, vault:document.querySelector('#vaultPath').value.trim(), ...(semanticModel ? {processor:'ollama-local', processor_endpoint:ollamaEndpoint.value.trim(), processor_model:semanticModel} : {})}),
    });
    const result = await compile.json();
    if (!compile.ok) throw new Error(result.error || `HTTP ${compile.status}`);
    document.querySelector('#reviewRecordId').value = result.record_id;
    await document.querySelector('#loadReview').click();
    lastCompletedJob = null;
    processStatus.textContent = `完成：已写入 Vault · ${result.path}`;
  } catch (error) {
    processStatus.textContent = `处理失败：${error.message}`;
  } finally { refreshActions(); }
});

saveReview.addEventListener('click', async () => {
  if (!reviewRecord) return;
  saveReview.disabled = true;
  try {
    const articles = [...reviewSegments.querySelectorAll('.review-segment')];
    for (const article of articles) {
      const original = reviewRecord.segments.find(item => item.id === article.dataset.segmentId);
      const text = article.querySelector('textarea').value.trim();
      const speaker = article.querySelector('input[aria-label="说话人"]').value.trim();
      const state = article.querySelector('select').value;
      const reviewFlags = article.querySelectorAll('.review-flags input[type="checkbox"]');
      const overlap = reviewFlags[0].checked;
      const unclear = reviewFlags[1].checked;
      const start = Number(article.querySelector('[aria-label="片段开始时间（秒）"]').value);
      const end = Number(article.querySelector('[aria-label="片段结束时间（秒）"]').value);
      const send = async (operation) => {
        const response = await fetch(`${apiUrl}/records/${encodeURIComponent(reviewRecord.id)}/corrections`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(operation)});
        if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`);
      };
      if (text !== original.text) await send({type:'edit_text', segment_id:original.id, text});
      const startInput = article.querySelector('[aria-label="片段开始时间（秒）"]');
      const endInput = article.querySelector('[aria-label="片段结束时间（秒）"]');
      if (startInput.value !== startInput.dataset.initialValue || endInput.value !== endInput.dataset.initialValue) {
        await send({type:'edit_timing', segment_id:original.id, start, end});
      }
      if (speaker !== original.speaker || state !== (original.speaker_status || 'unknown')) await send({type:'relabel', segment_id:original.id, speaker, speaker_status:state});
      if (overlap !== Boolean(original.overlap)) await send({type:'mark_overlap', segment_id:original.id, value:overlap});
      if (unclear !== Boolean(original.unclear)) await send({type:'mark_unclear', segment_id:original.id, value:unclear});
    }
    document.querySelector('#loadReview').click();
    reviewStatus.textContent = '修改已保存，并已写入审计历史';
  } catch (error) { reviewStatus.textContent = `保存失败：${error.message}`; saveReview.disabled = false; }
});

desktopStartReady.then(() => startNode()).then(waitForNode).catch(waitForNode);
