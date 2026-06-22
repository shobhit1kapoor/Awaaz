mod commands;
mod tray;

use commands::{cursor, monitor, screen, window};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            tray::setup_tray(app)?;
            if let Some(overlay_window) = app.get_webview_window("overlay") {
                window::make_overlay_click_through(overlay_window)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cursor::get_cursor_pos,
            cursor::move_cursor_to,
            monitor::list_monitors,
            screen::capture_screen,
            window::make_overlay_click_through
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
