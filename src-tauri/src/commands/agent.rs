#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub struct AgentStepRequest {
    pub step_type: String,
    pub target: Option<String>,
    pub query: Option<String>,
    pub text: Option<String>,
    pub key: Option<String>,
    pub duration_ms: Option<u64>,
    pub title_includes: Option<String>,
    pub role: Option<String>,
    pub name_includes: Option<String>,
    pub automation_id: Option<String>,
    pub control_id: Option<String>,
    pub selector: Option<String>,
    pub url: Option<String>,
}

#[derive(serde::Serialize)]
pub struct AgentStepResult {
    pub step_type: String,
    pub message: String,
}

#[tauri::command]
pub async fn execute_agent_step(step: AgentStepRequest) -> Result<AgentStepResult, String> {
    execute_agent_step_for_platform(step).await
}

async fn wait_for_duration(duration_ms: u64) -> Result<(), String> {
    let bounded_duration_ms = duration_ms.min(15_000);
    tokio::time::sleep(std::time::Duration::from_millis(bounded_duration_ms)).await;
    Ok(())
}

#[cfg(target_os = "windows")]
async fn execute_agent_step_for_platform(
    step: AgentStepRequest,
) -> Result<AgentStepResult, String> {
    match step.step_type.as_str() {
        "wait_ms" | "browser_wait" => {
            wait_for_duration(step.duration_ms.unwrap_or(500)).await?;
            Ok(done(step.step_type, "waited"))
        }
        "press_key" => {
            press_key(&required(step.key, "key")?)?;
            Ok(done(step.step_type, "pressed key"))
        }
        "wait_for_window" => {
            wait_for_window(
                &required(step.title_includes, "titleIncludes")?,
                step.duration_ms.unwrap_or(8_000),
            )
            .await?;
            Ok(done(step.step_type, "window found"))
        }
        "find_control" | "click_control" | "set_value" => Err(format!(
            "{} needs the Windows UI Automation backend, which is scaffolded but not implemented yet.",
            step.step_type
        )),
        "browser_open" | "browser_snapshot" | "browser_click" | "browser_type" => Err(format!(
            "{} needs the Chrome DevTools backend, which is scaffolded but not implemented yet.",
            step.step_type
        )),
        _ => Err(format!("Unsupported agent step: {}", step.step_type)),
    }
}

#[cfg(not(target_os = "windows"))]
async fn execute_agent_step_for_platform(
    step: AgentStepRequest,
) -> Result<AgentStepResult, String> {
    match step.step_type.as_str() {
        "wait_ms" | "browser_wait" => {
            wait_for_duration(step.duration_ms.unwrap_or(500)).await?;
            Ok(done(step.step_type, "waited"))
        }
        _ => Err(format!(
            "{} is only executable on Windows in the desktop app.",
            step.step_type
        )),
    }
}

fn done(step_type: String, message: &str) -> AgentStepResult {
    AgentStepResult {
        step_type,
        message: message.to_string(),
    }
}

#[cfg(target_os = "windows")]
fn required(value: Option<String>, field_name: &str) -> Result<String, String> {
    value
        .map(|field| field.trim().to_string())
        .filter(|field| !field.is_empty())
        .ok_or_else(|| format!("Agent step is missing {field_name}."))
}

#[cfg(target_os = "windows")]
fn press_key(key: &str) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
        VK_ESCAPE, VK_RETURN, VK_SPACE, VK_TAB,
    };

    let virtual_key = match key {
        "Enter" => VK_RETURN,
        "Escape" => VK_ESCAPE,
        "Tab" => VK_TAB,
        "Space" => VK_SPACE,
        _ => return Err(format!("Unsupported key: {key}")),
    };

    let inputs = [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(virtual_key.0),
                    wScan: 0,
                    dwFlags: Default::default(),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(virtual_key.0),
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];

    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err(format!(
            "Only {sent} of {} key events were sent.",
            inputs.len()
        ))
    }
}

#[cfg(target_os = "windows")]
async fn wait_for_window(title_includes: &str, timeout_ms: u64) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    while std::time::Instant::now() < deadline {
        if window_exists(title_includes)? {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
    Err(format!(
        "Could not find a window containing '{title_includes}'."
    ))
}

#[cfg(target_os = "windows")]
fn window_exists(title_includes: &str) -> Result<bool, String> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
    };

    struct SearchState {
        needle: String,
        found: bool,
    }

    unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let state = &mut *(lparam.0 as *mut SearchState);
        if !IsWindowVisible(hwnd).as_bool() {
            return true.into();
        }
        let title_length = GetWindowTextLengthW(hwnd);
        if title_length <= 0 {
            return true.into();
        }
        let mut title_buffer = vec![0_u16; title_length as usize + 1];
        let copied = GetWindowTextW(hwnd, &mut title_buffer);
        if copied <= 0 {
            return true.into();
        }
        let title = String::from_utf16_lossy(&title_buffer[..copied as usize]);
        if title.to_ascii_lowercase().contains(&state.needle) {
            state.found = true;
            return false.into();
        }
        true.into()
    }

    let mut state = SearchState {
        needle: title_includes.to_ascii_lowercase(),
        found: false,
    };
    unsafe {
        EnumWindows(
            Some(enum_window),
            LPARAM(&mut state as *mut SearchState as isize),
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(state.found)
}

#[cfg(test)]
mod tests {
    use super::wait_for_duration;

    #[tokio::test]
    async fn wait_duration_accepts_zero() {
        wait_for_duration(0)
            .await
            .expect("zero duration should wait");
    }
}
