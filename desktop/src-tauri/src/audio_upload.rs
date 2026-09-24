use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;

const API_HOST: &str = "127.0.0.1:8765";

pub fn upload_capture(path: &Path, source: &str) -> Result<serde_json::Value, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("录音已保存在 {}，但无法读取：{error}", path.display()))?;
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
        "POST /ledger/upload HTTP/1.1\r\nHost: {API_HOST}\r\nContent-Type: application/octet-stream\r\nX-File-Name: {name}\r\nX-Audio-Source: {source}\r\nContent-Length: {size}\r\nConnection: close\r\n\r\n")
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
    std::fs::remove_file(path).map_err(|error| {
        format!(
            "音频已写入账本，但清理临时缓存失败（{}）：{error}",
            path.display()
        )
    })?;
    Ok(asset)
}
