use std::collections::VecDeque;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use wasapi::{
    initialize_mta, AudioCaptureClient, AudioClient, DeviceEnumerator, Direction, SampleType,
    StreamMode, WaveFormat,
};

const API_HOST: &str = "127.0.0.1:8765";
const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u16 = 2;
const BYTES_PER_SAMPLE: u16 = 4;

struct ActiveCapture {
    stop: Arc<AtomicBool>,
    output: PathBuf,
    worker: JoinHandle<Result<PathBuf, String>>,
}

#[derive(Default)]
pub struct WindowsAudioState(Mutex<Option<ActiveCapture>>);

struct ComApartment;

impl Drop for ComApartment {
    fn drop(&mut self) {
        wasapi::deinitialize();
    }
}

impl Drop for WindowsAudioState {
    fn drop(&mut self) {
        if let Ok(active) = self.0.get_mut() {
            if let Some(capture) = active.take() {
                capture.stop.store(true, Ordering::Release);
                let _ = capture.worker.join();
            }
        }
    }
}

#[tauri::command]
pub fn start_system_audio_capture(
    app: AppHandle,
    state: State<'_, WindowsAudioState>,
) -> Result<String, String> {
    let mut active = state.0.lock().map_err(|_| "录音状态不可用".to_string())?;
    if active.is_some() {
        return Err("系统音频录音已经开始".to_string());
    }
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法访问本机录音缓存：{error}"))?;
    fs::create_dir_all(&cache).map_err(|error| format!("无法创建本机录音缓存：{error}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let output = cache.join(format!("voice-memory-system-audio-{stamp}.wav"));
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = Arc::clone(&stop);
    let worker_output = output.clone();
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let worker = thread::Builder::new()
        .name("voice-memory-wasapi-loopback".to_string())
        .spawn(move || capture_loopback(&worker_output, worker_stop, ready_tx))
        .map_err(|error| format!("无法启动 Windows 音频采集：{error}"))?;

    match ready_rx.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(Ok(())) => {
            *active = Some(ActiveCapture {
                stop,
                output,
                worker,
            });
            Ok(active.as_ref().unwrap().output.display().to_string())
        }
        Ok(Err(error)) => {
            let _ = worker.join();
            Err(error)
        }
        Err(error) => {
            stop.store(true, Ordering::Release);
            let _ = worker.join();
            Err(format!("Windows 音频设备未能及时启动：{error}"))
        }
    }
}

#[tauri::command]
pub fn stop_system_audio_capture(
    state: State<'_, WindowsAudioState>,
) -> Result<serde_json::Value, String> {
    let capture = state
        .0
        .lock()
        .map_err(|_| "录音状态不可用".to_string())?
        .take()
        .ok_or_else(|| "当前没有正在进行的系统音频录音".to_string())?;
    capture.stop.store(true, Ordering::Release);
    let file = match capture.worker.join() {
        Ok(Ok(file)) => file,
        Ok(Err(error)) => {
            return Err(format!(
                "{error}；录音缓存保留在 {}",
                capture.output.display()
            ))
        }
        Err(_) => {
            return Err(format!(
                "Windows 音频采集线程异常退出；录音缓存保留在 {}",
                capture.output.display()
            ))
        }
    };
    upload_capture(&file)
}

fn capture_loopback(
    output: &Path,
    stop: Arc<AtomicBool>,
    ready: mpsc::SyncSender<Result<(), String>>,
) -> Result<PathBuf, String> {
    if let Err(error) = initialize_mta().ok() {
        let message = format!("Windows 音频服务初始化失败：{error}");
        let _ = ready.send(Err(message.clone()));
        return Err(message);
    }
    let _com = ComApartment;
    let setup = (|| -> Result<(AudioClient, wasapi::Handle, AudioCaptureClient, File), String> {
        let enumerator = DeviceEnumerator::new()
            .map_err(|error| format!("无法枚举 Windows 音频设备：{error}"))?;
        let device = enumerator
            .get_default_device(&Direction::Render)
            .map_err(|error| format!("找不到默认扬声器/耳机输出设备：{error}"))?;
        let mut client = device
            .get_iaudioclient()
            .map_err(|error| format!("无法打开系统音频输出：{error}"))?;
        let format = WaveFormat::new(
            32,
            32,
            &SampleType::Float,
            SAMPLE_RATE as usize,
            CHANNELS as usize,
            None,
        );
        let mode = StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: 200_000,
        };
        client
            .initialize_client(&format, &Direction::Capture, &mode)
            .map_err(|error| format!("无法初始化 WASAPI 系统音频捕获：{error}"))?;
        let event = client
            .set_get_eventhandle()
            .map_err(|error| format!("无法建立系统音频缓冲事件：{error}"))?;
        let capture = client
            .get_audiocaptureclient()
            .map_err(|error| format!("无法读取系统音频缓冲：{error}"))?;
        let mut file =
            File::create(output).map_err(|error| format!("无法创建系统音频文件：{error}"))?;
        write_wav_header(&mut file, 0).map_err(|error| format!("无法初始化 WAV 文件：{error}"))?;
        client
            .start_stream()
            .map_err(|error| format!("系统音频录制启动失败：{error}"))?;
        Ok((client, event, capture, file))
    })();
    let (client, event, capture, mut file) = match setup {
        Ok(parts) => parts,
        Err(error) => {
            let _ = ready.send(Err(error.clone()));
            return Err(error);
        }
    };
    if ready.send(Ok(())).is_err() {
        let _ = client.stop_stream();
        return Err("系统音频录音启动请求已取消".to_string());
    }

    let mut samples = VecDeque::new();
    let mut data_bytes = 0u32;
    let recording = (|| -> Result<(), String> {
        while !stop.load(Ordering::Acquire) {
            // Timeouts are expected during silence; polling the stop flag bounds stop latency.
            let _ = event.wait_for_event(200);
            capture
                .read_from_device_to_deque(&mut samples)
                .map_err(|error| format!("系统音频采集读取失败：{error}"))?;
            if !samples.is_empty() {
                let chunk: Vec<u8> = samples.drain(..).collect();
                data_bytes = data_bytes
                    .checked_add(chunk.len() as u32)
                    .filter(|size| *size <= u32::MAX - 36)
                    .ok_or_else(|| "录音超过 WAV 格式单文件大小上限；已保留当前录音".to_string())?;
                file.write_all(&chunk)
                    .map_err(|error| format!("写入系统音频失败：{error}"))?;
            }
        }
        Ok(())
    })();
    let stop_result = client
        .stop_stream()
        .map_err(|error| format!("停止 WASAPI 音频流失败：{error}"));
    let header_result = write_wav_header(&mut file, data_bytes)
        .map_err(|error| format!("完成 WAV 文件头失败：{error}"));
    file.flush()
        .map_err(|error| format!("刷新系统音频文件失败：{error}"))?;
    recording?;
    stop_result?;
    header_result?;
    Ok(output.to_path_buf())
}

fn write_wav_header(file: &mut File, data_bytes: u32) -> std::io::Result<()> {
    let block_align = CHANNELS * BYTES_PER_SAMPLE;
    let byte_rate = SAMPLE_RATE * u32::from(block_align);
    file.seek(SeekFrom::Start(0))?;
    file.write_all(b"RIFF")?;
    file.write_all(&(36u32 + data_bytes).to_le_bytes())?;
    file.write_all(b"WAVEfmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&3u16.to_le_bytes())?; // IEEE float PCM
    file.write_all(&CHANNELS.to_le_bytes())?;
    file.write_all(&SAMPLE_RATE.to_le_bytes())?;
    file.write_all(&byte_rate.to_le_bytes())?;
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&(BYTES_PER_SAMPLE * 8).to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_bytes.to_le_bytes())?;
    file.seek(SeekFrom::End(0))?;
    Ok(())
}

fn upload_capture(path: &Path) -> Result<serde_json::Value, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("已录音但无法读取缓存文件 {}：{error}", path.display()))?;
    let size = file.metadata().map_err(|error| error.to_string())?.len();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "录音文件名无效".to_string())?;
    let mut stream = TcpStream::connect(API_HOST).map_err(|error| {
        format!(
            "录音已保存在 {}，但本地账本连接失败：{error}",
            path.display()
        )
    })?;
    write!(stream,
        "POST /ledger/upload HTTP/1.1\r\nHost: {API_HOST}\r\nContent-Type: application/octet-stream\r\nX-File-Name: {name}\r\nX-Audio-Source: system-audio-loopback\r\nContent-Length: {size}\r\nConnection: close\r\n\r\n")
        .map_err(|error| format!("录音已保存在 {}，上传请求失败：{error}", path.display()))?;
    std::io::copy(&mut file, &mut stream)
        .map_err(|error| format!("录音已保存在 {}，上传中断：{error}", path.display()))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("录音已保存在 {}，无法读取账本响应：{error}", path.display()))?;
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| format!("录音已保存在 {}，账本响应格式无效", path.display()))?;
    if !headers.starts_with("HTTP/1.1 201") && !headers.starts_with("HTTP/1.0 201") {
        return Err(format!(
            "录音已保存在 {}，写入账本失败：{}",
            path.display(),
            body.trim()
        ));
    }
    let asset: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| format!("录音已保存在 {}，账本响应解析失败：{error}", path.display()))?;
    fs::remove_file(path).map_err(|error| {
        format!(
            "音频已写入账本，但清理临时缓存失败（{}）：{error}",
            path.display()
        )
    })?;
    Ok(asset)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header_matches_float_capture_payload() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("voice-memory-wav-{stamp}.tmp"));
        let mut file = File::create(&path).unwrap();
        file.write_all(&[1, 2, 3, 4]).unwrap();
        write_wav_header(&mut file, 4).unwrap();
        file.seek(SeekFrom::Start(0)).unwrap();
        let mut header = [0u8; 44];
        file.read_exact(&mut header).unwrap();
        assert_eq!(&header[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(header[4..8].try_into().unwrap()), 40);
        assert_eq!(&header[8..16], b"WAVEfmt ");
        assert_eq!(u16::from_le_bytes(header[20..22].try_into().unwrap()), 3);
        assert_eq!(
            u16::from_le_bytes(header[22..24].try_into().unwrap()),
            CHANNELS
        );
        assert_eq!(
            u32::from_le_bytes(header[24..28].try_into().unwrap()),
            SAMPLE_RATE
        );
        assert_eq!(&header[36..40], b"data");
        assert_eq!(u32::from_le_bytes(header[40..44].try_into().unwrap()), 4);
        drop(file);
        fs::remove_file(path).unwrap();
    }
}
