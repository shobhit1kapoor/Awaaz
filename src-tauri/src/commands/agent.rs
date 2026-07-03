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
        "spotify_play_first_result" => {
            click_spotify_first_result()?;
            Ok(done(
                step.step_type,
                "clicked Spotify first result play button",
            ))
        }
        "spotify_like_first_result" => {
            click_spotify_first_result_like()?;
            Ok(done(
                step.step_type,
                "clicked Spotify first result like button",
            ))
        }
        "word_create_document" => {
            create_word_document(&required(step.text, "text")?)?;
            Ok(done(step.step_type, "created Word document"))
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
    if normalized_url.starts_with("spotify:") {
        open_shell_uri(&normalized_url)?;
        return Ok(());
    }

    if open_chrome_default_profile(Some(&normalized_url)).is_ok() {
        return Ok(());
    }

    std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "Start-Process -FilePath $args[0]",
        ])
        .arg(&normalized_url)
        .spawn()
        .map_err(|error| format!("Could not open browser URL: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn open_chrome_default_profile(url: Option<&str>) -> Result<(), String> {
    let chrome_path = find_chrome_executable()
        .ok_or_else(|| "Could not find Google Chrome on this Windows profile.".to_string())?;
    let mut command = std::process::Command::new(chrome_path);
    command.arg("--profile-directory=Default");
    if let Some(url) = url {
        command.arg(url);
    }
    command
        .spawn()
        .map_err(|error| format!("Could not open Chrome: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn find_chrome_executable() -> Option<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        candidates.push(
            std::path::PathBuf::from(program_files).join("Google/Chrome/Application/chrome.exe"),
        );
    }
    if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)") {
        candidates.push(
            std::path::PathBuf::from(program_files_x86)
                .join("Google/Chrome/Application/chrome.exe"),
        );
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(
            std::path::PathBuf::from(local_app_data).join("Google/Chrome/Application/chrome.exe"),
        );
    }
    candidates.into_iter().find(|path| path.exists())
}

#[cfg(target_os = "windows")]
fn open_shell_uri(uri: &str) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let operation = wide_null("open");
    let file = wide_null(uri);
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(operation.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    let code = result.0 as isize;
    if code <= 32 {
        return Err(format!(
            "Could not open URI '{uri}': Windows ShellExecute returned code {code}."
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
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
        let stderr = clean_powershell_error(&String::from_utf8_lossy(&output.stderr));
        let stdout = clean_powershell_error(&String::from_utf8_lossy(&output.stdout));
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
fn clean_powershell_error(raw_text: &str) -> String {
    let trimmed_text = raw_text.trim();
    if trimmed_text.is_empty() {
        return String::new();
    }
    if !trimmed_text.contains("#< CLIXML") {
        return trimmed_text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
    }

    let mut messages = Vec::new();
    let mut remaining_text = trimmed_text;
    while let Some(start_index) = remaining_text.find("<S S=\"Error\">") {
        let message_start = start_index + "<S S=\"Error\">".len();
        let Some(end_index) = remaining_text[message_start..].find("</S>") else {
            break;
        };
        let message = remaining_text[message_start..message_start + end_index]
            .replace("_x000D__x000A_", " ")
            .replace("_x000D_", " ")
            .replace("_x000A_", " ")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&");
        let cleaned_message = message.trim();
        if !cleaned_message.is_empty()
            && !cleaned_message.starts_with('+')
            && !cleaned_message.starts_with("At line:")
            && !cleaned_message.starts_with("CategoryInfo")
            && !cleaned_message.starts_with("FullyQualifiedErrorId")
        {
            messages.push(cleaned_message.to_string());
        }
        remaining_text = &remaining_text[message_start + end_index + "</S>".len()..];
    }

    messages
        .first()
        .cloned()
        .unwrap_or_else(|| "PowerShell returned an unreadable UI Automation error.".to_string())
}

#[cfg(target_os = "windows")]
fn ps_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(target_os = "windows")]
fn create_word_document(text: &str) -> Result<(), String> {
    if text.chars().count() > 20_000 {
        return Err("The Word document draft is too long to create safely.".to_string());
    }
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $true
$document = $word.Documents.Add()
$selection = $word.Selection
$selection.TypeText({})
"#,
        ps_string(text)
    );
    run_powershell_text(&script).map(|_| ())
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
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  $lastError = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $window = Get-AwaazForegroundWindow
      Start-Sleep -Milliseconds 150
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
          $rect = $current.BoundingRectangle
          if ($rect.IsEmpty -or $rect.Width -le 1 -or $rect.Height -le 1) { continue }
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
        } catch {
          $lastError = $_.Exception.Message
        }
      }
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 300
  }
  if ($lastError) {
    throw "Could not find a matching control in the foreground window. Last UIA error: $lastError"
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
      $rect = $current.BoundingRectangle
      if ($rect.IsEmpty -or $rect.Width -le 1 -or $rect.Height -le 1) { continue }
      return $control
    } catch {}
  }
  throw 'The selected UI Automation control disappeared.'
}

function Get-AwaazClickableDescendant {
  param($Control)
  try {
    $children = $Control.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($child in $children) {
      try {
        $current = $child.Current
        if (-not $current.IsEnabled -or $current.IsOffscreen) { continue }
        $rect = $current.BoundingRectangle
        if (-not $rect.IsEmpty -and $rect.Width -gt 1 -and $rect.Height -gt 1) {
          return $child
        }
      } catch {}
    }
  } catch {}
  return $null
}

function Invoke-AwaazControlClick {
  param([string]$Name = '', [string]$AutomationId = '', [string]$ControlType = '')
  $control = Resolve-AwaazControl -Name $Name -AutomationId $AutomationId -ControlType $ControlType
  try { $control.SetFocus() } catch {}
  $pattern = $null
  if ($control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    try {
      $pattern.Invoke()
      'clicked'
      return
    } catch {}
  }
  if ($control.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
    try {
      $pattern.Select()
      'selected'
      return
    } catch {}
  }
  $rect = $control.Current.BoundingRectangle
  if ($rect.IsEmpty -or $rect.Width -le 1 -or $rect.Height -le 1) {
    $child = Get-AwaazClickableDescendant -Control $control
    if ($null -eq $child) { throw 'Control has no clickable rectangle.' }
    $control = $child
    $rect = $control.Current.BoundingRectangle
  }
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
  try { $control.SetFocus() } catch {}
  $pattern = $null
  if ($control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    try {
      $pattern.SetValue($Text)
      'value set'
      return
    } catch {}
  }
  $rect = $control.Current.BoundingRectangle
  if ($rect.IsEmpty -or $rect.Width -le 1 -or $rect.Height -le 1) {
    $child = Get-AwaazClickableDescendant -Control $control
    if ($null -eq $child) { throw 'Control does not support ValuePattern and has no editable rectangle.' }
    $control = $child
    $rect = $control.Current.BoundingRectangle
  }
  $x = [int]($rect.Left + ($rect.Width / 2))
  $y = [int]($rect.Top + ($rect.Height / 2))
  [AwaazNative]::SetCursorPos($x, $y) | Out-Null
  [AwaazNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [AwaazNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.Clipboard]::SetText($Text)
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  'value pasted'
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
fn click_spotify_first_result() -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    let mut last_error = "Spotify was not ready yet.".to_string();
    while std::time::Instant::now() < deadline {
        match click_spotify_first_result_once(false) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = error;
                std::thread::sleep(std::time::Duration::from_millis(400));
            }
        }
    }
    click_spotify_first_result_once(true).map_err(|fallback_error| {
        format!("Spotify did not expose the first result play button in time: {last_error}. Fallback click also failed: {fallback_error}")
    })
}

#[cfg(target_os = "windows")]
fn click_spotify_first_result_like() -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    let mut last_error = "Spotify was not ready yet.".to_string();
    while std::time::Instant::now() < deadline {
        match click_spotify_first_result_like_once(false) {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = error;
                std::thread::sleep(std::time::Duration::from_millis(400));
            }
        }
    }
    click_spotify_first_result_like_once(true).map_err(|fallback_error| {
        format!("Spotify did not expose the first result like button in time: {last_error}. Fallback click also failed: {fallback_error}")
    })
}

#[cfg(target_os = "windows")]
fn click_spotify_first_result_once(allow_fallback_click: bool) -> Result<(), String> {
    let (rect, hwnd) = spotify_window_rect()?;

    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    let fallback_x = rect.left + ((width as f64) * 0.69).round() as i32;
    let fallback_y = rect.top + ((height as f64) * 0.165).round() as i32;
    let (x, y) = match find_spotify_green_play_button(rect)? {
        Some(point) => point,
        None if allow_fallback_click => (fallback_x, fallback_y),
        None => return Err("Spotify first-result play button is not visible yet.".to_string()),
    };

    click_screen_point(hwnd, x, y)
}

#[cfg(target_os = "windows")]
fn click_spotify_first_result_like_once(allow_fallback_click: bool) -> Result<(), String> {
    let (rect, hwnd) = spotify_window_rect()?;
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;

    // Spotify renders the save/like control immediately to the left of the
    // first result's green play button. It is a small gray plus/check icon,
    // so color detection is much less reliable than for the play button.
    let point = find_spotify_green_play_button(rect)?
        .map(|(play_x, play_y)| {
            let offset = ((width as f64) * 0.03).round() as i32;
            (play_x - offset.max(36), play_y)
        })
        .or_else(|| {
            allow_fallback_click.then_some((
                rect.left + ((width as f64) * 0.66).round() as i32,
                rect.top + ((height as f64) * 0.165).round() as i32,
            ))
        });

    let Some((x, y)) = point else {
        return Err("Spotify first-result like button is not visible yet.".to_string());
    };
    click_screen_point(hwnd, x, y)
}

#[cfg(target_os = "windows")]
fn spotify_window_rect() -> Result<
    (
        windows::Win32::Foundation::RECT,
        windows::Win32::Foundation::HWND,
    ),
    String,
> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
        SetForegroundWindow,
    };

    struct SearchState {
        hwnd: HWND,
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
        if title.to_ascii_lowercase().contains("spotify") {
            state.hwnd = hwnd;
            return false.into();
        }
        true.into()
    }

    let mut state = SearchState {
        hwnd: HWND::default(),
    };
    let enum_result = unsafe {
        EnumWindows(
            Some(enum_window),
            LPARAM(&mut state as *mut SearchState as isize),
        )
    };
    if state.hwnd.0.is_null() {
        enum_result.map_err(|error| error.to_string())?;
        return Err("Spotify is not open yet.".to_string());
    }

    let hwnd = state.hwnd;
    unsafe {
        let _ = SetForegroundWindow(hwnd);
    }
    std::thread::sleep(std::time::Duration::from_millis(180));

    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect).map_err(|error| error.to_string())? };
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width < 400 || height < 300 {
        return Err(
            "Spotify window is too small to click the first search result safely.".to_string(),
        );
    }

    Ok((rect, hwnd))
}

#[cfg(target_os = "windows")]
fn click_screen_point(
    hwnd: windows::Win32::Foundation::HWND,
    x: i32,
    y: i32,
) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
        MOUSEINPUT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{SetCursorPos, SetForegroundWindow};

    unsafe {
        let _ = SetForegroundWindow(hwnd);
        std::thread::sleep(std::time::Duration::from_millis(120));
        SetCursorPos(x, y).map_err(|error| error.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(120));
    }
    let down_input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: 0,
                dwFlags: MOUSEEVENTF_LEFTDOWN,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let up_input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: 0,
                dwFlags: MOUSEEVENTF_LEFTUP,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let sent_down = unsafe { SendInput(&[down_input], std::mem::size_of::<INPUT>() as i32) };
    std::thread::sleep(std::time::Duration::from_millis(90));
    let sent_up = unsafe { SendInput(&[up_input], std::mem::size_of::<INPUT>() as i32) };
    if sent_down != 1 || sent_up != 1 {
        return Err(format!(
            "Spotify play click did not send cleanly: down={sent_down}, up={sent_up}."
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn find_spotify_green_play_button(
    rect: windows::Win32::Foundation::RECT,
) -> Result<Option<(i32, i32)>, String> {
    use windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC};

    let hdc = unsafe { GetDC(None) };
    if hdc.0.is_null() {
        return Err(
            "Could not read the screen while waiting for Spotify's play button.".to_string(),
        );
    }

    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    let x_start = rect.left + ((width as f64) * 0.56).round() as i32;
    let x_end = rect.left + ((width as f64) * 0.78).round() as i32;
    let y_start = rect.top + ((height as f64) * 0.10).round() as i32;
    let y_end = rect.top + ((height as f64) * 0.25).round() as i32;

    let mut green_count = 0;
    let mut min_x = i32::MAX;
    let mut max_x = i32::MIN;
    let mut min_y = i32::MAX;
    let mut max_y = i32::MIN;

    for y in (y_start..=y_end).step_by(4) {
        for x in (x_start..=x_end).step_by(4) {
            let color = unsafe { GetPixel(hdc, x, y) };
            if spotify_green_colorref(color.0) {
                green_count += 1;
                min_x = min_x.min(x);
                max_x = max_x.max(x);
                min_y = min_y.min(y);
                max_y = max_y.max(y);
            }
        }
    }
    unsafe {
        ReleaseDC(None, hdc);
    }

    if green_count < 8 {
        return Ok(None);
    }
    Ok(Some(((min_x + max_x) / 2, (min_y + max_y) / 2)))
}

#[cfg(target_os = "windows")]
fn spotify_green_colorref(colorref: u32) -> bool {
    let red = colorref & 0xff;
    let green = (colorref >> 8) & 0xff;
    let blue = (colorref >> 16) & 0xff;
    green > 120 && green > red + 35 && green > blue + 30
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
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible, SetForegroundWindow,
    };

    struct SearchState {
        needle: String,
        found: bool,
        hwnd: HWND,
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
            state.hwnd = hwnd;
            return false.into();
        }
        true.into()
    }

    let mut state = SearchState {
        needle: title_includes.to_ascii_lowercase(),
        found: false,
        hwnd: HWND::default(),
    };
    let enum_result = unsafe {
        EnumWindows(
            Some(enum_window),
            LPARAM(&mut state as *mut SearchState as isize),
        )
    };
    if state.found {
        unsafe {
            let _ = SetForegroundWindow(state.hwnd);
        }
        return Ok(true);
    }
    enum_result.map_err(|error| error.to_string())?;
    Ok(false)
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
