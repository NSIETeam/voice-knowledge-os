//! Settings key-value commands. Thin wrappers over `db::*`, surfaced to the
//! frontend via `commands::settings_*` (re-exported from the parent module).

use super::err;
use crate::db;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn settings_get(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    let conn = state.db.lock();
    db::get_setting(&conn, &key).map_err(err)
}

#[tauri::command]
pub fn settings_set(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let conn = state.db.lock();
    persist_setting(&conn, &key, &value)
}

fn persist_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    let value = if key == "mimo_base_url" {
        crate::providers::resolve_mimo_base_url(Some(value.to_string()))?
    } else {
        value.to_string()
    };
    db::set_setting(conn, key, &value).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_endpoint_never_overwrites_a_working_destination() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .unwrap();
        let valid = "https://token-plan-cn.xiaomimimo.com/v1";
        persist_setting(&conn, "mimo_base_url", valid).unwrap();
        for invalid in [
            "http://example.test/v1",
            "https://user:fixture@example.test/v1",
            "https://example.test/v1?key=fixture",
            "https://example.test/v1#fragment",
            "invalid",
        ] {
            assert!(persist_setting(&conn, "mimo_base_url", invalid).is_err());
            assert_eq!(
                db::get_setting(&conn, "mimo_base_url").unwrap().as_deref(),
                Some(valid)
            );
        }
        persist_setting(&conn, "mimo_base_url", " https://gateway.example/v1/ ").unwrap();
        assert_eq!(
            db::get_setting(&conn, "mimo_base_url").unwrap().as_deref(),
            Some("https://gateway.example/v1")
        );
        persist_setting(&conn, "chat_model", "Home {fixture}").unwrap();
        assert_eq!(
            db::get_setting(&conn, "chat_model").unwrap().as_deref(),
            Some("Home {fixture}")
        );
    }
}
