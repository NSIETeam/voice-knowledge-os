use crate::{audio_upload::upload_capture, audio_wav::write_float_wav_header};
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    Data, SampleFormat, StreamConfig,
};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

struct ActiveCapture {
    stop: Arc<AtomicBool>,
    output: PathBuf,
    worker: JoinHandle<Result<PathBuf, String>>,
}

#[derive(Default)]
pub struct MicrophoneCaptureState(Mutex<Option<ActiveCapture>>);

impl Drop for MicrophoneCaptureState {
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
pub fn start_microphone_capture(
    app: AppHandle,
    state: State<'_, MicrophoneCaptureState>,
) -> Result<String, String> {
    let mut active = state.0.lock().map_err(|_| "录音状态不可用".to_string())?;
    if active.is_some() {
        return Err("麦克风录音已经开始".to_string());
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
    let output = cache.join(format!("voice-memory-microphone-{stamp}.wav"));
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = Arc::clone(&stop);
    let worker_output = output.clone();
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let worker = thread::Builder::new()
        .name("voice-memory-coreaudio-microphone".to_string())
        .spawn(move || capture_microphone(&worker_output, worker_stop, ready_tx))
        .map_err(|error| format!("无法启动 macOS 麦克风采集：{error}"))?;

    match ready_rx.recv_timeout(Duration::from_secs(15)) {
        Ok(Ok(())) => {
            *active = Some(ActiveCapture {
                stop,
                output: output.clone(),
                worker,
            });
            Ok(output.display().to_string())
        }
        Ok(Err(error)) => {
            let _ = worker.join();
            let _ = fs::remove_file(&output);
            Err(error)
        }
        Err(error) => {
            stop.store(true, Ordering::Release);
            let _ = worker.join();
            Err(format!("macOS 麦克风未能及时启动：{error}"))
        }
    }
}

#[tauri::command]
pub fn stop_microphone_capture(
    state: State<'_, MicrophoneCaptureState>,
) -> Result<serde_json::Value, String> {
    let capture = state
        .0
        .lock()
        .map_err(|_| "录音状态不可用".to_string())?
        .take()
        .ok_or_else(|| "当前没有正在进行的麦克风录音".to_string())?;
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
                "macOS 麦克风采集线程异常退出；录音缓存保留在 {}",
                capture.output.display()
            ))
        }
    };
    upload_capture(&file, "microphone-capture")
}

fn capture_microphone(
    output: &Path,
    stop: Arc<AtomicBool>,
    ready: mpsc::SyncSender<Result<(), String>>,
) -> Result<PathBuf, String> {
    let setup = (|| -> Result<_, String> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "找不到默认麦克风；请在 macOS 声音设置中选择输入设备".to_string())?;
        let supported = device
            .default_input_config()
            .map_err(|error| format!("无法读取麦克风配置或权限被拒绝：{error}"))?;
        let sample_format = supported.sample_format();
        if !matches!(sample_format, SampleFormat::F32 | SampleFormat::I16) {
            return Err(format!(
                "当前麦克风采样格式 {sample_format:?} 暂不支持；请选择标准 CoreAudio 输入设备"
            ));
        }
        let config: StreamConfig = supported.into();
        if config.channels == 0 || config.sample_rate == 0 {
            return Err("麦克风返回了无效的采样配置".to_string());
        }
        let file =
            File::create(output).map_err(|error| format!("无法创建麦克风录音文件：{error}"))?;
        let (samples_tx, samples_rx) = mpsc::sync_channel::<Vec<u8>>(128);
        let overflowed = Arc::new(AtomicBool::new(false));
        let callback_overflowed = Arc::clone(&overflowed);
        let callback_error = Arc::new(Mutex::new(None::<String>));
        let stream_error = Arc::clone(&callback_error);
        let stream = device
            .build_input_stream_raw(
                config.clone(),
                sample_format,
                move |data: &Data, _| {
                    let payload = match sample_format {
                        SampleFormat::F32 => data.as_slice::<f32>().map(|samples| {
                            samples
                                .iter()
                                .flat_map(|sample| sample.to_le_bytes())
                                .collect()
                        }),
                        SampleFormat::I16 => data.as_slice::<i16>().map(|samples| {
                            samples
                                .iter()
                                .flat_map(|sample| ((*sample as f32) / 32768.0).to_le_bytes())
                                .collect()
                        }),
                        _ => None,
                    };
                    match payload {
                        Some(bytes) => {
                            if samples_tx.try_send(bytes).is_err() {
                                callback_overflowed.store(true, Ordering::Release);
                            }
                        }
                        None => callback_overflowed.store(true, Ordering::Release),
                    }
                },
                move |error| {
                    if let Ok(mut current) = stream_error.lock() {
                        *current = Some(error.to_string());
                    }
                },
                Some(Duration::from_secs(10)),
            )
            .map_err(|error| format!("无法打开麦克风；请检查系统隐私权限：{error}"))?;
        let mut file = file;
        write_float_wav_header(&mut file, config.sample_rate, config.channels, 0)
            .map_err(|error| format!("无法初始化麦克风 WAV 文件：{error}"))?;
        stream
            .play()
            .map_err(|error| format!("麦克风启动失败；请检查系统隐私权限：{error}"))?;
        Ok((stream, file, samples_rx, overflowed, callback_error, config))
    })();

    let (stream, mut file, samples_rx, overflowed, callback_error, config) = match setup {
        Ok(parts) => parts,
        Err(error) => {
            let _ = ready.send(Err(error.clone()));
            return Err(error);
        }
    };
    if ready.send(Ok(())).is_err() {
        drop(stream);
        return Err("麦克风录音启动请求已取消".to_string());
    }

    let mut data_bytes = 0u32;
    let mut last_header_update = Instant::now();
    let mut capture_error = None;
    loop {
        if stop.load(Ordering::Acquire) {
            break;
        }
        match samples_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(chunk) => {
                let chunk_len = u32::try_from(chunk.len()).unwrap_or(u32::MAX);
                data_bytes = match data_bytes.checked_add(chunk_len) {
                    Some(size) if size <= u32::MAX - 36 => size,
                    _ => {
                        capture_error = Some("录音达到 WAV 文件大小上限".to_string());
                        break;
                    }
                };
                if let Err(error) = file.write_all(&chunk) {
                    capture_error = Some(format!("写入麦克风录音失败：{error}"));
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if let Ok(error) = callback_error.lock() {
            if let Some(error) = error.as_ref() {
                capture_error = Some(format!("麦克风采集异常：{error}"));
                break;
            }
        }
        if last_header_update.elapsed() >= Duration::from_secs(1) {
            write_float_wav_header(&mut file, config.sample_rate, config.channels, data_bytes)
                .map_err(|error| format!("更新录音文件头失败：{error}"))?;
            file.flush()
                .map_err(|error| format!("刷新麦克风录音缓存失败：{error}"))?;
            last_header_update = Instant::now();
        }
    }
    drop(stream);
    while let Ok(chunk) = samples_rx.try_recv() {
        let chunk_len = u32::try_from(chunk.len()).unwrap_or(u32::MAX);
        data_bytes = data_bytes
            .checked_add(chunk_len)
            .filter(|size| *size <= u32::MAX - 36)
            .ok_or_else(|| format!("录音达到 WAV 文件大小上限；缓存保留在 {}", output.display()))?;
        file.write_all(&chunk)
            .map_err(|error| format!("写入麦克风录音失败：{error}"))?;
    }
    write_float_wav_header(&mut file, config.sample_rate, config.channels, data_bytes)
        .map_err(|error| format!("完成麦克风 WAV 文件头失败：{error}"))?;
    file.flush()
        .map_err(|error| format!("刷新麦克风录音文件失败：{error}"))?;
    if overflowed.load(Ordering::Acquire) {
        return Err(format!(
            "录音写入速度跟不上音频输入；可恢复缓存保留在 {}",
            output.display()
        ));
    }
    if let Some(error) = capture_error {
        return Err(format!("{error}；录音缓存保留在 {}", output.display()));
    }
    if data_bytes == 0 {
        return Err(format!(
            "没有收到麦克风音频；录音缓存保留在 {}",
            output.display()
        ));
    }
    Ok(output.to_path_buf())
}
