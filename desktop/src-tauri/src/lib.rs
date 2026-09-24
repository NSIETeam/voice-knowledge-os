use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    windows_process::contain_process_tree();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(target_os = "windows")]
    let builder = builder
        .manage(windows_audio::WindowsAudioState::default())
        .invoke_handler(tauri::generate_handler![
            windows_audio::start_system_audio_capture,
            windows_audio::stop_system_audio_capture,
            approve_app_exit,
            desktop_process_id,
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder
        .manage(macos_audio::MicrophoneCaptureState::default())
        .invoke_handler(tauri::generate_handler![
            macos_audio::start_microphone_capture,
            macos_audio::stop_microphone_capture,
            approve_app_exit,
            mark_ui_ready,
            terminate_sidecar_tree,
            register_sidecar_pid,
            clear_sidecar_pid,
            desktop_process_id,
        ]);

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        approve_app_exit,
        mark_ui_ready,
        desktop_process_id,
    ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while running Voice Memory desktop application");

    #[cfg(target_os = "macos")]
    app.run(|handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if UI_READY.load(std::sync::atomic::Ordering::Acquire)
                && !APP_EXIT_APPROVED.load(std::sync::atomic::Ordering::Acquire)
            {
                api.prevent_exit();
                let pid = SIDECAR_PID.load(std::sync::atomic::Ordering::Acquire);
                let result = if pid == 0 {
                    Ok(())
                } else {
                    terminate_sidecar_tree(pid)
                };
                match result {
                    Ok(()) => {
                        SIDECAR_PID.store(0, std::sync::atomic::Ordering::Release);
                        APP_EXIT_APPROVED.store(true, std::sync::atomic::Ordering::Release);
                        handle.exit(0);
                    }
                    Err(error) => {
                        eprintln!("Voice Memory sidecar shutdown failed: {error}");
                        let _ = handle.emit("voice-memory://quit-requested", ());
                    }
                }
            }
        }
    });

    #[cfg(not(target_os = "macos"))]
    app.run(|_, _| {});
}

#[cfg(target_os = "macos")]
static APP_EXIT_APPROVED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(target_os = "macos")]
static UI_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(target_os = "macos")]
static SIDECAR_PID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

#[tauri::command]
fn mark_ui_ready() {
    #[cfg(target_os = "macos")]
    UI_READY.store(true, std::sync::atomic::Ordering::Release);
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn register_sidecar_pid(pid: u32) -> Result<(), String> {
    if pid == 0 || pid == std::process::id() {
        return Err("refusing to register an invalid sidecar PID".into());
    }
    SIDECAR_PID.store(pid, std::sync::atomic::Ordering::Release);
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn clear_sidecar_pid() {
    SIDECAR_PID.store(0, std::sync::atomic::Ordering::Release);
}

#[tauri::command]
fn desktop_process_id() -> u32 {
    std::process::id()
}

#[tauri::command]
fn approve_app_exit(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    APP_EXIT_APPROVED.store(true, std::sync::atomic::Ordering::Release);
    app.exit(0);
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn terminate_sidecar_tree(root_pid: u32) -> Result<(), String> {
    use std::{
        process::Command,
        thread,
        time::{Duration, Instant},
    };

    fn descendants(pid: u32, ordered: &mut Vec<u32>) -> Result<(), String> {
        let output = Command::new("/usr/bin/pgrep")
            .args(["-P", &pid.to_string()])
            .output()
            .map_err(|error| format!("could not enumerate sidecar children: {error}"))?;
        for child in String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.trim().parse::<u32>().ok())
        {
            descendants(child, ordered)?;
        }
        ordered.push(pid);
        Ok(())
    }

    let current_pid = std::process::id();
    if root_pid == 0 || root_pid == current_pid {
        return Err("refusing to terminate an invalid sidecar PID".into());
    }
    let root_command = Command::new("/bin/ps")
        .args(["-p", &root_pid.to_string(), "-o", "command="])
        .output()
        .map_err(|error| format!("could not verify sidecar process: {error}"))?;
    let root_command = String::from_utf8_lossy(&root_command.stdout);
    if !root_command.contains("voice-memory-node") {
        return Err(format!("PID {root_pid} is not the Voice Memory sidecar"));
    }
    let executable_end = root_command
        .find("/Contents/MacOS/voice-memory-node")
        .map(|index| index + "/Contents/MacOS/voice-memory-node".len())
        .ok_or_else(|| format!("PID {root_pid} is not running from a packaged app"))?;
    let executable = &root_command[..executable_end];

    let mut tree = Vec::new();
    descendants(root_pid, &mut tree)?;
    let all_processes = Command::new("/bin/ps")
        .args(["-Ao", "pid=,command="])
        .output()
        .map_err(|error| format!("could not enumerate sidecar processes: {error}"))?;
    for line in String::from_utf8_lossy(&all_processes.stdout).lines() {
        let Some((pid, command)) = line.trim().split_once(char::is_whitespace) else {
            continue;
        };
        let (Ok(pid), command) = (pid.trim().parse::<u32>(), command.trim()) else {
            continue;
        };
        if command
            .strip_prefix(executable)
            .is_some_and(|suffix| suffix.is_empty() || suffix.starts_with(char::is_whitespace))
        {
            tree.push(pid);
        }
    }
    tree.sort_unstable();
    tree.dedup();
    eprintln!("Voice Memory sidecar shutdown: executable={executable:?}, pids={tree:?}");
    for pid in &tree {
        let _ = Command::new("/bin/kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        let alive = tree.iter().any(|pid| {
            Command::new("/bin/kill")
                .args(["-0", &pid.to_string()])
                .status()
                .map(|status| status.success())
                .unwrap_or(false)
        });
        if !alive {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    for pid in &tree {
        let _ = Command::new("/bin/kill")
            .args(["-KILL", &pid.to_string()])
            .status();
    }
    Ok(())
}

mod audio_upload;
mod audio_wav;

#[cfg(target_os = "macos")]
mod macos_audio;

#[cfg(target_os = "windows")]
mod windows_audio;

#[cfg(target_os = "windows")]
mod windows_process;
