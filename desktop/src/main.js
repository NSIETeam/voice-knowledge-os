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

startNode().then(waitForNode).catch(waitForNode);
