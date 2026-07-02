#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
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

#[cfg(target_os = "windows")]
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "PascalCase")]
struct ControlDescriptor {
    name: String,
    automation_id: String,
    control_type: String,
    class_name: String,
}

#[cfg(target_os = "windows")]
static LAST_CONTROL: std::sync::OnceLock<std::sync::Mutex<Option<ControlDescriptor>>> =
    std::sync::OnceLock::new();

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
        "find_control" => {
            let control = find_control(
                step.role.as_deref(),
                step.name_includes.as_deref(),
                step.automation_id.as_deref(),
            )?;
            remember_control(control.clone())?;
            Ok(done(
                step.step_type,
                &format!(
                    "found {} {}",
                    control.control_type,
                    display_control_name(&control)
                ),
            ))
        }
        "click_control" => {
            click_control(step.control_id.as_deref())?;
            Ok(done(step.step_type, "clicked control"))
        }
        "set_value" => {
            set_control_value(step.control_id.as_deref(), &required(step.text, "text")?)?;
            Ok(done(step.step_type, "set control value"))
        }
        "browser_open" => {
            open_browser_url(&required(step.url, "url")?)?;
            Ok(done(step.step_type, "opened browser URL"))
        }
        "browser_snapshot" | "browser_click" | "browser_type" => Err(format!(
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
fn remember_control(control: ControlDescriptor) -> Result<(), String> {
    let last_control = LAST_CONTROL.get_or_init(|| std::sync::Mutex::new(None));
    *last_control
        .lock()
        .map_err(|_| "UIA control memory lock was poisoned.".to_string())? = Some(control);
    Ok(())
}

#[cfg(target_os = "windows")]
fn remembered_control() -> Result<Option<ControlDescriptor>, String> {
    let last_control = LAST_CONTROL.get_or_init(|| std::sync::Mutex::new(None));
    Ok(last_control
        .lock()
        .map_err(|_| "UIA control memory lock was poisoned.".to_string())?
        .clone())
}

#[cfg(target_os = "windows")]
fn required(value: Option<String>, field_name: &str) -> Result<String, String> {
    value
        .map(|field| field.trim().to_string())
        .filter(|field| !field.is_empty())
        .ok_or_else(|| format!("Agent step is missing {field_name}."))
}

#[cfg(target_os = "windows")]
fn find_control(
    role: Option<&str>,
    name_includes: Option<&str>,
    automation_id: Option<&str>,
) -> Result<ControlDescriptor, String> {
    let script = format!(
        "{}\n{}\nFind-AwaazControl -Role {} -NameIncludes {} -AutomationId {}",
        uia_powershell_prelude(),
        uia_find_function(),
        ps_string(&normalize_uia_role(role.unwrap_or_default())),
        ps_string(name_includes.unwrap_or_default()),
        ps_string(automation_id.unwrap_or_default())
    );
    let output = run_powershell_json(&script)?;
    serde_json::from_str::<ControlDescriptor>(&output)
        .map_err(|error| format!("Could not parse UI Automation control result: {error}: {output}"))
}

#[cfg(target_os = "windows")]
fn click_control(control_id: Option<&str>) -> Result<(), String> {
    let descriptor = control_id_to_descriptor(control_id)?;
    let script = format!(
        "{}\n{}\nInvoke-AwaazControlClick -Name {} -AutomationId {} -ControlType {}",
        uia_powershell_prelude(),
        uia_find_function(),
        ps_string(&descriptor.name),
        ps_string(&descriptor.automation_id),
        ps_string(&descriptor.control_type)
    );
    run_powershell_text(&script).map(|_| ())
}

#[cfg(target_os = "windows")]
fn set_control_value(control_id: Option<&str>, text: &str) -> Result<(), String> {
    let descriptor = control_id_to_descriptor(control_id)?;
    let script = format!(
        "{}\n{}\nSet-AwaazControlValue -Name {} -AutomationId {} -ControlType {} -Text {}",
        uia_powershell_prelude(),
        uia_find_function(),
        ps_string(&descriptor.name),
        ps_string(&descriptor.automation_id),
        ps_string(&descriptor.control_type),
        ps_string(text)
    );
    run_powershell_text(&script).map(|_| ())
}

#[cfg(target_os = "windows")]
fn control_id_to_descriptor(control_id: Option<&str>) -> Result<ControlDescriptor, String> {
    if let Some(control_id) = control_id.map(str::trim).filter(|value| !value.is_empty()) {
        return Ok(ControlDescriptor {
            name: control_id.to_string(),
            automation_id: String::new(),
            control_type: String::new(),
            class_name: String::new(),
        });
    }

    remembered_control()?.ok_or_else(|| {
        "No UI Automation control is selected yet. Run find_control before this step.".to_string()
    })
}

#[cfg(target_os = "windows")]
fn display_control_name(control: &ControlDescriptor) -> String {
    if !control.name.is_empty() {
        format!("named '{}'", control.name)
    } else if !control.automation_id.is_empty() {
        format!("with automation id '{}'", control.automation_id)
    } else {
        "control".to_string()
    }
}

#[cfg(target_os = "windows")]
fn normalize_uia_role(role: &str) -> String {
    match role.trim().to_ascii_lowercase().as_str() {
        "textbox" | "text box" | "input" | "search" | "searchbox" | "search box" => {
            "Edit".to_string()
        }
        "button" => "Button".to_string(),
        "listitem" | "list item" | "result" => "ListItem".to_string(),
        "tab" => "TabItem".to_string(),
        other => other.to_string(),
    }
}

#[cfg(target_os = "windows")]
fn open_browser_url(url: &str) -> Result<(), String> {
    let normalized_url = normalize_agent_url(url)?;
    std::process::Command::new("explorer.exe")
        .arg(&normalized_url)
        .spawn()
        .map_err(|error| format!("Could not open browser URL: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn normalize_agent_url(url: &str) -> Result<String, String> {
    let trimmed_url = url.trim();
    if trimmed_url.is_empty() || trimmed_url.len() > 500 {
        return Err("Browser URL must contain between 1 and 500 characters.".to_string());
    }
    let normalized_url = if trimmed_url.starts_with("http://")
        || trimmed_url.starts_with("https://")
        || trimmed_url.starts_with("spotify:")
    {
        trimmed_url.to_string()
    } else if trimmed_url.starts_with("localhost") {
        format!("http://{trimmed_url}")
    } else {
        format!("https://{trimmed_url}")
    };
    if normalized_url.contains(char::is_whitespace) {
        return Err("Browser URL cannot contain whitespace.".to_string());
    }
    Ok(normalized_url)
}

#[cfg(target_os = "windows")]
fn run_powershell_json(script: &str) -> Result<String, String> {
    let output = run_powershell_text(script)?;
    output
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .map(|line| line.trim().to_string())
        .ok_or_else(|| format!("UI Automation did not return JSON. Output: {output}"))
}

#[cfg(target_os = "windows")]
fn run_powershell_text(script: &str) -> Result<String, String> {
    use base64::Engine;

    let encoded_script_bytes = script
        .encode_utf16()
        .flat_map(|unit| unit.to_le_bytes())
        .collect::<Vec<_>>();
    let encoded_script = base64::engine::general_purpose::STANDARD.encode(encoded_script_bytes);
    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            &encoded_script,
        ])
        .output()
        .map_err(|error| format!("Could not run UI Automation PowerShell backend: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(format!(
            "UI Automation backend failed: {}{}",
            stderr,
            if stdout.is_empty() {
                String::new()
            } else {
                format!(" Output: {stdout}")
            }
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "windows")]
fn ps_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(target_os = "windows")]
fn uia_powershell_prelude() -> &'static str {
    r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AwaazNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
"@
"#
}

#[cfg(target_os = "windows")]
fn uia_find_function() -> &'static str {
    r#"
function Test-AwaazContains($Value, $Needle) {
  if ([string]::IsNullOrWhiteSpace($Needle)) { return $true }
  if ($null -eq $Value) { return $false }
  return $Value.IndexOf($Needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Get-AwaazForegroundWindow {
  $hwnd = [AwaazNative]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { throw 'No foreground window is available.' }
  return [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
}

function Find-AwaazControl {
  param(
    [string]$Role = '',
    [string]$NameIncludes = '',
    [string]$AutomationId = '',
    [string]$ControlType = ''
  )
  $window = Get-AwaazForegroundWindow
  $controls = $window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )

  foreach ($control in $controls) {
    try {
      $current = $control.Current
      if (-not $current.IsEnabled -or $current.IsOffscreen) { continue }
      $name = [string]$current.Name
      $id = [string]$current.AutomationId
      $type = [string]$current.ControlType.ProgrammaticName
      $class = [string]$current.ClassName
      if (-not (Test-AwaazContains $name $NameIncludes)) { continue }
      if (-not (Test-AwaazContains $id $AutomationId)) { continue }
      if (-not (Test-AwaazContains $type $ControlType)) { continue }
      if (-not (Test-AwaazContains $type $Role)) { continue }

      [pscustomobject]@{
        Name = $name
        AutomationId = $id
        ControlType = $type
        ClassName = $class
      } | ConvertTo-Json -Compress
      return
    } catch {}
  }
  throw "Could not find a matching control in the foreground window."
}

function Resolve-AwaazControl {
  param([string]$Name = '', [string]$AutomationId = '', [string]$ControlType = '')
  $json = Find-AwaazControl -NameIncludes $Name -AutomationId $AutomationId -ControlType $ControlType
  $descriptor = $json | ConvertFrom-Json
  $window = Get-AwaazForegroundWindow
  $controls = $window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($control in $controls) {
    try {
      $current = $control.Current
      if (-not $current.IsEnabled -or $current.IsOffscreen) { continue }
      if ($descriptor.AutomationId -and $current.AutomationId -ne $descriptor.AutomationId) { continue }
      if ($descriptor.Name -and $current.Name -ne $descriptor.Name) { continue }
      if ($descriptor.ControlType -and $current.ControlType.ProgrammaticName -ne $descriptor.ControlType) { continue }
      return $control
    } catch {}
  }
  throw 'The selected UI Automation control disappeared.'
}

function Invoke-AwaazControlClick {
  param([string]$Name = '', [string]$AutomationId = '', [string]$ControlType = '')
  $control = Resolve-AwaazControl -Name $Name -AutomationId $AutomationId -ControlType $ControlType
  $control.SetFocus()
  $pattern = $null
  if ($control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    $pattern.Invoke()
    'clicked'
    return
  }
  if ($control.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
    $pattern.Select()
    'selected'
    return
  }
  $rect = $control.Current.BoundingRectangle
  if ($rect.IsEmpty) { throw 'Control has no clickable rectangle.' }
  $x = [int]($rect.Left + ($rect.Width / 2))
  $y = [int]($rect.Top + ($rect.Height / 2))
  [AwaazNative]::SetCursorPos($x, $y) | Out-Null
  [AwaazNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [AwaazNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  'clicked by coordinates'
}

function Set-AwaazControlValue {
  param([string]$Name = '', [string]$AutomationId = '', [string]$ControlType = '', [string]$Text = '')
  $control = Resolve-AwaazControl -Name $Name -AutomationId $AutomationId -ControlType $ControlType
  $control.SetFocus()
  $pattern = $null
  if ($control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    $pattern.SetValue($Text)
    'value set'
    return
  }
  throw 'Control does not support ValuePattern.'
}
"#
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
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
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
