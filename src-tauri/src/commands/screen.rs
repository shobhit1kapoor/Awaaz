#[derive(serde::Serialize)]
pub struct ScreenCaptureResult {
    pub base64: String,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub monitor_id: u32,
}

#[tauri::command]
pub async fn capture_screen() -> Result<ScreenCaptureResult, String> {
    capture_screen_for_platform().await
}

#[cfg(target_os = "windows")]
async fn capture_screen_for_platform() -> Result<ScreenCaptureResult, String> {
    Err("Windows screen capture with windows-capture is not implemented yet.".to_string())
}

#[cfg(not(target_os = "windows"))]
async fn capture_screen_for_platform() -> Result<ScreenCaptureResult, String> {
    Ok(ScreenCaptureResult {
        base64: String::new(),
        cursor_x: 0,
        cursor_y: 0,
        monitor_id: 0,
    })
}
