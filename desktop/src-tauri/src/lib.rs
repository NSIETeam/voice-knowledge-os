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
        ]);

    #[cfg(not(target_os = "windows"))]
    let builder = builder.invoke_handler(tauri::generate_handler![approve_app_exit, mark_ui_ready]);

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
                let _ = handle.emit("voice-memory://quit-requested", ());
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

#[tauri::command]
fn mark_ui_ready() {
    #[cfg(target_os = "macos")]
    UI_READY.store(true, std::sync::atomic::Ordering::Release);
}

#[tauri::command]
fn approve_app_exit(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    APP_EXIT_APPROVED.store(true, std::sync::atomic::Ordering::Release);
    app.exit(0);
}

mod audio_wav;

#[cfg(target_os = "windows")]
mod windows_audio;

#[cfg(target_os = "windows")]
mod windows_process;
