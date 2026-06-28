#[tauri::command]
pub fn make_overlay_click_through(window: tauri::WebviewWindow) -> Result<(), String> {
    make_overlay_click_through_for_platform(window)
}

pub fn configure_overlay_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    use tauri::{PhysicalPosition, PhysicalSize};

    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let left = monitors
        .iter()
        .map(|monitor| monitor.position().x)
        .min()
        .ok_or_else(|| "No monitor is available for the overlay.".to_string())?;
    let top = monitors
        .iter()
        .map(|monitor| monitor.position().y)
        .min()
        .ok_or_else(|| "No monitor is available for the overlay.".to_string())?;
    let right = monitors
        .iter()
        .map(|monitor| monitor.position().x + monitor.size().width as i32)
        .max()
        .ok_or_else(|| "No monitor is available for the overlay.".to_string())?;
    let bottom = monitors
        .iter()
        .map(|monitor| monitor.position().y + monitor.size().height as i32)
        .max()
        .ok_or_else(|| "No monitor is available for the overlay.".to_string())?;

    window
        .set_position(PhysicalPosition::new(left, top))
        .map_err(|error| error.to_string())?;
    window
        .set_size(PhysicalSize::new(
            (right - left) as u32,
            (bottom - top) as u32,
        ))
        .map_err(|error| error.to_string())?;
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window
        .set_skip_taskbar(true)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn make_overlay_click_through_for_platform(window: tauri::WebviewWindow) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
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
                | WS_EX_TOOLWINDOW.0 as isize
                | WS_EX_NOACTIVATE.0 as isize,
        );
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn make_overlay_click_through_for_platform(_window: tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}
