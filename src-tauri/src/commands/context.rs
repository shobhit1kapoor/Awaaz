#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveWindowContext {
    pub title: String,
    pub app_name: Option<String>,
}

#[tauri::command]
pub fn get_active_window_context() -> Result<ActiveWindowContext, String> {
    get_active_window_context_for_platform()
}

#[cfg(target_os = "windows")]
fn get_active_window_context_for_platform() -> Result<ActiveWindowContext, String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
    };

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return Ok(ActiveWindowContext {
            title: String::new(),
            app_name: None,
        });
    }

    let title_length = unsafe { GetWindowTextLengthW(hwnd) };
    if title_length <= 0 {
        return Ok(ActiveWindowContext {
            title: String::new(),
            app_name: None,
        });
    }

    let mut title_buffer = vec![0_u16; title_length as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut title_buffer) };
    let title = if copied > 0 {
        String::from_utf16_lossy(&title_buffer[..copied as usize])
    } else {
        String::new()
    };
    let app_name = infer_app_name_from_title(&title);

    Ok(ActiveWindowContext { title, app_name })
}

#[cfg(not(target_os = "windows"))]
fn get_active_window_context_for_platform() -> Result<ActiveWindowContext, String> {
    Ok(ActiveWindowContext {
        title: String::new(),
        app_name: None,
    })
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn infer_app_name_from_title(title: &str) -> Option<String> {
    let trimmed_title = title.trim();
    if trimmed_title.is_empty() {
        return None;
    }

    trimmed_title
        .split(['-', '—', '|'])
        .next_back()
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::infer_app_name_from_title;

    #[test]
    fn infers_app_name_from_common_window_title() {
        assert_eq!(
            infer_app_name_from_title("Untitled-1 @ 100% - Adobe Photoshop"),
            Some("Adobe Photoshop".to_string())
        );
    }
}
