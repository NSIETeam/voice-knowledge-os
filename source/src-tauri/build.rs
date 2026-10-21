use std::path::Path;

fn main() {
    let config_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    let config: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(config_path).expect("read tauri.conf.json"),
    )
    .expect("parse tauri.conf.json");
    let identifier = config["identifier"]
        .as_str()
        .expect("tauri.conf.json must declare an application identifier");
    println!("cargo:rustc-env=HONEYVOICE_BUNDLE_ID={identifier}");

    tauri_build::build()
}
