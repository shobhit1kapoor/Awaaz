#[derive(serde::Serialize)]
pub struct MonitorInfo {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[tauri::command]
pub fn list_monitors(app_handle: tauri::AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app_handle
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let primary_monitor_name = app_handle
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .and_then(|primary_monitor| primary_monitor.name().map(ToOwned::to_owned));

    Ok(monitors
        .iter()
        .enumerate()
        .map(|(monitor_index, monitor)| MonitorInfo {
            id: monitor_index as u32,
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
            scale_factor: monitor.scale_factor(),
            is_primary: monitor.name().map(|monitor_name| monitor_name.as_str())
                == primary_monitor_name.as_deref(),
        })
        .collect())
}
