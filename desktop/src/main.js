import { Command } from '@tauri-apps/plugin-shell';
import { open } from '@tauri-apps/plugin-dialog';

const status = document.querySelector('#status');
const recordStatus = document.querySelector('#recordStatus');
const assetStatus = document.querySelector('#assetStatus');
const processStatus = document.querySelector('#processStatus');
const assetImportButton = document.querySelector('#importAudio');
const transcribeButton = document.querySelector('#transcribe');
let nodeProcess;
const apiUrl = 'http://127.0.0.1:8765';
let currentAsset;
let lastCompletedJob;

for (const id of ['vaultPath', 'whisperPath', 'modelPath', 'ffmpegPath', 'ollamaModel']) {
  document.querySelector(`#${id}`).value = localStorage.getItem(`voice-memory.${id}`) || '';
  document.querySelector(`#${id}`).addEventListener('change', (event) => localStorage.setItem(`voice-memory.${id}`, event.target.value));
}
const ollamaEndpoint = document.querySelector('#ollamaEndpoint');
ollamaEndpoint.value = localStorage.getItem('voice-memory.ollamaEndpoint') || 'http://127.0.0.1:11434';
ollamaEndpoint.addEventListener('change', () => localStorage.setItem('voice-memory.ollamaEndpoint', ollamaEndpoint.value));

function refreshActions() {
  const ready = Boolean(currentAsset && document.querySelector('#vaultPath').value.trim() && document.querySelector('#whisperPath').value.trim() && document.querySelector('#modelPath').value.trim());
  transcribeButton.disabled = !ready;
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

async function uploadAudio(blob, name) {
  assetStatus.textContent = '正在写入本地音频账本…';
  const response = await fetch(`${apiUrl}/ledger/upload`, {
    method:'POST',
    headers:{'Content-Type':'application/octet-stream', 'X-File-Name':encodeURIComponent(name)},
    body:blob,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  if (currentAsset?.id !== result.id) lastCompletedJob = null;
  currentAsset = result;
  assetStatus.textContent = `已保存：${result.original_name} · ${result.size_bytes} bytes · SHA-256 ${result.sha256.slice(0, 12)}…`;
  refreshActions();
  return result;
}

document.querySelector('#audioFile').addEventListener('change', (event) => {
  assetImportButton.disabled = !event.target.files?.length;
  currentAsset = null;
  lastCompletedJob = null;
  assetStatus.textContent = event.target.files?.length ? '已选择文件，点击“导入账本”' : '尚未选择音频';
  refreshActions();
  const file = event.target.files?.[0];
  if (file && !document.querySelector('#recordTitle').value) {
    document.querySelector('#recordTitle').value = file.name.replace(/\.[^.]+$/, '');
  }
});

assetImportButton.addEventListener('click', async () => {
  const file = document.querySelector('#audioFile').files?.[0];
  if (!file) return;
  assetImportButton.disabled = true;
  try { await uploadAudio(file, file.name); processStatus.textContent = '音频已导入，配置转写后即可生成记录'; }
  catch (error) { assetStatus.textContent = `导入失败：${error.message}`; }
  finally { assetImportButton.disabled = false; }
});

async function startNode() {
  try {
    nodeProcess = await Command.sidecar('binaries/voice-memory-node', ['serve']);
    await nodeProcess.spawn();
  } catch (error) {
    console.info('sidecar unavailable in browser/dev mode', error);
  }
}

window.addEventListener('beforeunload', () => {
  void nodeProcess?.kill();
});

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
    status.textContent = '本地处理节点未启动，请先运行 voice-memory serve';
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForNode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

document.querySelector('#retry').addEventListener('click', check);
let recorder;
let chunks = [];
document.querySelector('#record').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (recorder?.state === 'recording') { recorder.stop(); button.textContent = '开始录音'; return; }
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
        await uploadAudio(blob, `microphone-${Date.now()}.${extension}`);
        recordStatus.textContent = '录音已写入本地音频账本';
        if (!document.querySelector('#recordTitle').value) document.querySelector('#recordTitle').value = `录音 ${localTimestamp()}`;
      } catch (error) { recordStatus.textContent = `写入失败：${error.message}`; }
    };
    recorder.start(); button.textContent = '停止并保存'; recordStatus.textContent = '录音中（仅麦克风）';
  } catch (error) { recordStatus.textContent = `无法访问麦克风：${error.message}`; }
});

let reviewRecord;
const reviewStatus = document.querySelector('#reviewStatus');
const reviewSegments = document.querySelector('#reviewSegments');
const saveReview = document.querySelector('#saveReview');
const reanalyzeButton = document.querySelector('#reanalyze');
const reviewAudio = document.querySelector('#reviewAudio');

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
    const time = document.createElement('span');
    time.textContent = `${segment.start.toFixed(1)}s–${segment.end.toFixed(1)}s`;
    meta.append(time, reviewBadge(segment.speaker_status));
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
    const play = document.createElement('button');
    play.type = 'button'; play.textContent = '播放此段';
    play.addEventListener('click', async () => {
      if (!reviewRecord.audio_asset_id) { reviewStatus.textContent = '此记录未关联本地音频资产'; return; }
      reviewAudio.src = `${apiUrl}/ledger/${encodeURIComponent(reviewRecord.audio_asset_id)}/content`;
      reviewAudio.style.display = 'block';
      try {
        if (reviewAudio.readyState < HTMLMediaElement.HAVE_METADATA) {
          await new Promise((resolve, reject) => {
            reviewAudio.addEventListener('loadedmetadata', resolve, {once:true});
            reviewAudio.addEventListener('error', () => reject(new Error('音频无法读取')), {once:true});
            reviewAudio.load();
          });
        }
        reviewAudio.currentTime = segment.start;
        await reviewAudio.play();
      } catch (error) { reviewStatus.textContent = `无法播放：${error.message}`; }
    });
    article.append(meta, text, flags, play);
    reviewSegments.append(article);
  }
  saveReview.disabled = false;
  reanalyzeButton.disabled = !document.querySelector('#ollamaModel').value.trim();
}

document.querySelector('#loadReview').addEventListener('click', async () => {
  const id = document.querySelector('#reviewRecordId').value.trim();
  if (!id) { reviewStatus.textContent = '请先输入记录 ID'; return; }
  try {
    const response = await fetch(`${apiUrl}/records/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const sidecar = await response.json();
    reviewRecord = sidecar.record;
    document.querySelector('#profile').value = reviewRecord.primary_mode;
    renderReview(reviewRecord);
    reviewStatus.textContent = `已加载 ${reviewRecord.title}，历史修正 ${sidecar.correction_history?.length || 0} 次`;
  } catch (error) { reviewStatus.textContent = `加载失败：${error.message}`; reviewSegments.replaceChildren(); saveReview.disabled = true; }
});

document.querySelector('#ollamaModel').addEventListener('input', () => {
  reanalyzeButton.disabled = !reviewRecord || !document.querySelector('#ollamaModel').value.trim();
});

reanalyzeButton.addEventListener('click', async () => {
  if (!reviewRecord) return;
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
    document.querySelector('#profile').value = reviewRecord.primary_mode;
    renderReview(reviewRecord);
    reviewStatus.textContent = '本机整理完成；结果已关联当前转写，仍需逐条核验。';
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
      const overlap = article.querySelectorAll('input[type="checkbox"]')[0].checked;
      const unclear = article.querySelectorAll('input[type="checkbox"]')[1].checked;
      const send = async (operation) => {
        const response = await fetch(`${apiUrl}/records/${encodeURIComponent(reviewRecord.id)}/corrections`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(operation)});
        if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`);
      };
      if (text !== original.text) await send({type:'edit_text', segment_id:original.id, text});
      if (speaker !== original.speaker || state !== (original.speaker_status || 'unknown')) await send({type:'relabel', segment_id:original.id, speaker, speaker_status:state});
      if (overlap !== Boolean(original.overlap)) await send({type:'mark_overlap', segment_id:original.id, value:overlap});
      if (unclear !== Boolean(original.unclear)) await send({type:'mark_unclear', segment_id:original.id, value:unclear});
    }
    document.querySelector('#loadReview').click();
    reviewStatus.textContent = '修改已保存，并已写入审计历史';
  } catch (error) { reviewStatus.textContent = `保存失败：${error.message}`; saveReview.disabled = false; }
});

startNode().then(waitForNode).catch(waitForNode);
