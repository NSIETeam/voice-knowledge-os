import { Command } from '@tauri-apps/plugin-shell';

const status = document.querySelector('#status');
const recordStatus = document.querySelector('#recordStatus');
let nodeProcess;
const apiUrl = 'http://127.0.0.1:8765';

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
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = ''; bytes.forEach(byte => binary += String.fromCharCode(byte));
      const response = await fetch(`${apiUrl}/ledger/upload`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name:'microphone.webm', data_base64:btoa(binary)})});
      recordStatus.textContent = response.ok ? '录音已写入本地音频账本' : '写入失败，请检查本地节点';
    };
    recorder.start(); button.textContent = '停止并保存'; recordStatus.textContent = '录音中（仅麦克风）';
  } catch (error) { recordStatus.textContent = `无法访问麦克风：${error.message}`; }
});

let reviewRecord;
const reviewStatus = document.querySelector('#reviewStatus');
const reviewSegments = document.querySelector('#reviewSegments');
const saveReview = document.querySelector('#saveReview');

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
    article.append(meta, text, flags);
    reviewSegments.append(article);
  }
  saveReview.disabled = false;
}

document.querySelector('#loadReview').addEventListener('click', async () => {
  const id = document.querySelector('#reviewRecordId').value.trim();
  if (!id) { reviewStatus.textContent = '请先输入记录 ID'; return; }
  try {
    const response = await fetch(`${apiUrl}/records/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const sidecar = await response.json();
    reviewRecord = sidecar.record;
    renderReview(reviewRecord);
    reviewStatus.textContent = `已加载 ${reviewRecord.title}，历史修正 ${sidecar.correction_history?.length || 0} 次`;
  } catch (error) { reviewStatus.textContent = `加载失败：${error.message}`; reviewSegments.replaceChildren(); saveReview.disabled = true; }
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
