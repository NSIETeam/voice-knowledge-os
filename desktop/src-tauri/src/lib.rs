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
        ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running Voice Memory desktop application");
}

mod audio_wav;

#[cfg(target_os = "windows")]
mod windows_audio;

#[cfg(target_os = "windows")]
mod windows_process;
