#[tauri::command]
pub fn get_cursor_pos() -> Result<(i32, i32), String> {
    get_cursor_pos_for_platform()
}

#[tauri::command]
pub async fn move_cursor_to(x: i32, y: i32, duration_ms: u64) -> Result<(), String> {
    move_cursor_to_for_platform(x, y, duration_ms).await
}

#[cfg(target_os = "windows")]
fn get_cursor_pos_for_platform() -> Result<(i32, i32), String> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut cursor_position = POINT { x: 0, y: 0 };
    unsafe { GetCursorPos(&mut cursor_position).map_err(|error| error.to_string())? };
    Ok((cursor_position.x, cursor_position.y))
}

#[cfg(not(target_os = "windows"))]
fn get_cursor_pos_for_platform() -> Result<(i32, i32), String> {
    Ok((0, 0))
}

#[cfg(target_os = "windows")]
async fn move_cursor_to_for_platform(x: i32, y: i32, duration_ms: u64) -> Result<(), String> {
    use std::time::Duration;
    use windows::Win32::UI::Input::KeyboardAndMouse::SetCursorPos;

    let (start_x, start_y) = get_cursor_pos_for_platform()?;
    let animation_steps = 60_u64.max(duration_ms / 8);
    let step_duration_ms = (duration_ms / animation_steps).max(1);

    for animation_step in 0..=animation_steps {
        let progress = animation_step as f64 / animation_steps as f64;
        let eased_progress = if progress < 0.5 {
            4.0 * progress * progress * progress
        } else {
            1.0 - (-2.0 * progress + 2.0).powi(3) / 2.0
        };
        let next_x = start_x as f64 + (x - start_x) as f64 * eased_progress;
        let next_y = start_y as f64 + (y - start_y) as f64 * eased_progress;
        unsafe {
            SetCursorPos(next_x.round() as i32, next_y.round() as i32)
                .map_err(|error| error.to_string())?
        };
        tokio::time::sleep(Duration::from_millis(step_duration_ms)).await;
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
async fn move_cursor_to_for_platform(_x: i32, _y: i32, _duration_ms: u64) -> Result<(), String> {
    Err("Moving the system cursor is only available on Windows.".to_string())
}
