#[tauri::command]
pub fn make_overlay_click_through(window: tauri::WebviewWindow) -> Result<(), String> {
    make_overlay_click_through_for_platform(window)
}

#[cfg(target_os = "windows")]
fn make_overlay_click_through_for_platform(window: tauri::WebviewWindow) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TOOLWINDOW,
        WS_EX_TRANSPARENT,
    };

    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    unsafe {
        let window_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            window_style
                | WS_EX_TRANSPARENT.0 as isize
                | WS_EX_LAYERED.0 as isize
                | WS_EX_TOOLWINDOW.0 as isize,
        );
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn make_overlay_click_through_for_platform(_window: tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}
