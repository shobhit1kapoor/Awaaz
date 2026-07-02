#[derive(serde::Serialize)]
pub struct OpenTargetResult {
    pub kind: String,
    pub query: String,
    pub opened_path: String,
}

#[tauri::command]
pub async fn open_windows_target(kind: String, query: String) -> Result<OpenTargetResult, String> {
    tokio::task::spawn_blocking(move || open_windows_target_for_platform(&kind, &query))
        .await
        .map_err(|error| format!("Windows action task failed: {error}"))?
}

#[cfg(target_os = "windows")]
fn open_windows_target_for_platform(kind: &str, query: &str) -> Result<OpenTargetResult, String> {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    let trimmed_query = query.trim();
    if trimmed_query.is_empty() || trimmed_query.len() > 120 {
        return Err("The target name must contain between 1 and 120 characters.".to_string());
    }

    if kind == "open_url" {
        let url = normalize_url(trimmed_query)?;
        open_url(&url)?;
        return Ok(OpenTargetResult {
            kind: kind.to_string(),
            query: trimmed_query.to_string(),
            opened_path: url,
        });
    }

    if kind == "web_search" {
        let url = format!(
            "https://www.google.com/search?q={}",
            percent_encode_query(trimmed_query)
        );
        open_url(&url)?;
        return Ok(OpenTargetResult {
            kind: kind.to_string(),
            query: trimmed_query.to_string(),
            opened_path: url,
        });
    }

    if kind == "type_text" {
        type_text(trimmed_query)?;
        return Ok(OpenTargetResult {
            kind: kind.to_string(),
            query: trimmed_query.to_string(),
            opened_path: "active window".to_string(),
        });
    }

    let target_path = match kind {
        "open_app" => resolve_application(trimmed_query)?,
        "open_folder" => resolve_folder(trimmed_query)?,
        _ => return Err(format!("Unsupported Windows action: {kind}")),
    };

    if kind == "open_folder" {
        Command::new("explorer.exe")
            .arg(&target_path)
            .spawn()
            .map_err(|error| format!("Could not open folder: {error}"))?;
    } else if target_path
        .extension()
        .is_some_and(|extension| extension == "lnk")
    {
        Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Process -FilePath $args[0]",
            ])
            .arg(&target_path)
            .spawn()
            .map_err(|error| format!("Could not open application shortcut: {error}"))?;
    } else {
        Command::new(&target_path)
            .spawn()
            .map_err(|error| format!("Could not open application: {error}"))?;
    }

    return Ok(OpenTargetResult {
        kind: kind.to_string(),
        query: trimmed_query.to_string(),
        opened_path: display_path(&target_path),
    });

    fn display_path(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    fn resolve_application(query: &str) -> Result<PathBuf, String> {
        let normalized_query = normalize_name(query);
        let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);

        let known_executable = match normalized_query.as_str() {
            "spotify" => local_app_data
                .as_ref()
                .map(|root| root.join("Microsoft/WindowsApps/Spotify.exe")),
            "calculator" | "calc" => Some(PathBuf::from("calc.exe")),
            "notepad" => Some(PathBuf::from("notepad.exe")),
            "file explorer" | "explorer" => Some(PathBuf::from("explorer.exe")),
            _ => None,
        };
        if let Some(executable) = known_executable {
            if !executable.is_absolute() || executable.exists() {
                return Ok(executable);
            }
        }

        if let Some(windows_apps) = local_app_data.map(|root| root.join("Microsoft/WindowsApps")) {
            if let Some(executable) = find_best_named_entry(&windows_apps, query, 1, &["exe"]) {
                return Ok(executable);
            }
        }

        let mut start_menu_roots = Vec::new();
        if let Some(app_data) = std::env::var_os("APPDATA") {
            start_menu_roots
                .push(PathBuf::from(app_data).join("Microsoft/Windows/Start Menu/Programs"));
        }
        if let Some(program_data) = std::env::var_os("ProgramData") {
            start_menu_roots
                .push(PathBuf::from(program_data).join("Microsoft/Windows/Start Menu/Programs"));
        }

        start_menu_roots
            .iter()
            .filter_map(|root| find_best_named_entry(root, query, 6, &["lnk", "exe"]))
            .min_by_key(|path| path.components().count())
            .ok_or_else(|| format!("Could not find an installed application named '{query}'."))
    }

    fn resolve_folder(query: &str) -> Result<PathBuf, String> {
        let user_profile = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .ok_or_else(|| "Windows user profile directory is unavailable.".to_string())?;
        let one_drive = std::env::var_os("OneDrive").map(PathBuf::from);
        let mut roots = Vec::new();

        if let Some(one_drive_root) = &one_drive {
            roots.push(one_drive_root.join("Desktop"));
        }
        roots.push(user_profile.join("Desktop"));
        roots.push(user_profile.join("Documents"));
        roots.push(user_profile.join("Downloads"));
        if let Some(one_drive_root) = &one_drive {
            roots.push(one_drive_root.join("Documents"));
            roots.push(one_drive_root.clone());
        }

        for root in roots {
            if let Some(folder) = find_best_named_entry(&root, query, 6, &[]) {
                if folder.is_dir() {
                    return Ok(folder);
                }
            }
        }

        Err(format!(
            "Could not find a folder named '{query}' in Desktop, Documents, Downloads, or OneDrive."
        ))
    }

    fn normalize_url(query: &str) -> Result<String, String> {
        let trimmed_query = query.trim();
        if trimmed_query.len() > 300 {
            return Err("URL is too long.".to_string());
        }
        let url = if trimmed_query.starts_with("http://") || trimmed_query.starts_with("https://") {
            trimmed_query.to_string()
        } else if trimmed_query.starts_with("localhost") {
            format!("http://{trimmed_query}")
        } else {
            format!("https://{trimmed_query}")
        };
        let lower_url = url.to_ascii_lowercase();
        if !(lower_url.starts_with("http://") || lower_url.starts_with("https://")) {
            return Err("Only http and https URLs can be opened.".to_string());
        }
        if url.contains(char::is_whitespace) {
            return Err("URL cannot contain whitespace.".to_string());
        }
        Ok(url)
    }

    fn open_url(url: &str) -> Result<(), String> {
        Command::new("explorer.exe")
            .arg(url)
            .spawn()
            .map_err(|error| format!("Could not open URL: {error}"))?;
        Ok(())
    }

    fn percent_encode_query(query: &str) -> String {
        query
            .bytes()
            .flat_map(|byte| match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    vec![byte as char]
                }
                b' ' => vec!['+'],
                _ => format!("%{byte:02X}").chars().collect(),
            })
            .collect()
    }

    fn type_text(text: &str) -> Result<(), String> {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
            KEYEVENTF_UNICODE, VIRTUAL_KEY,
        };

        if text.chars().count() > 1_000 {
            return Err("Text is too long to type safely.".to_string());
        }

        let mut inputs = Vec::new();
        for utf16_unit in text.encode_utf16() {
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: utf16_unit,
                        dwFlags: KEYEVENTF_UNICODE,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: utf16_unit,
                        dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
        }

        if inputs.is_empty() {
            return Ok(());
        }

        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent == inputs.len() as u32 {
            Ok(())
        } else {
            Err(format!(
                "Only {sent} of {} keyboard events were sent.",
                inputs.len()
            ))
        }
    }

    fn find_best_named_entry(
        root: &Path,
        query: &str,
        max_depth: usize,
        allowed_extensions: &[&str],
    ) -> Option<PathBuf> {
        let normalized_query = normalize_name(query);
        let mut candidates = Vec::new();
        collect_named_entries(
            root,
            &normalized_query,
            max_depth,
            allowed_extensions,
            &mut candidates,
        );
        candidates
            .into_iter()
            .min_by_key(|(score, path)| (*score, path.components().count()))
            .map(|(_, path)| path)
    }

    fn collect_named_entries(
        directory: &Path,
        normalized_query: &str,
        remaining_depth: usize,
        allowed_extensions: &[&str],
        candidates: &mut Vec<(u8, PathBuf)>,
    ) {
        if remaining_depth == 0 || !directory.is_dir() {
            return;
        }
        let Ok(entries) = std::fs::read_dir(directory) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let normalized_entry_name = normalize_name(
                path.file_stem()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default(),
            );
            let extension_allowed = allowed_extensions.is_empty()
                || path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| {
                        allowed_extensions
                            .iter()
                            .any(|allowed| extension.eq_ignore_ascii_case(allowed))
                    });

            if extension_allowed {
                if normalized_entry_name == normalized_query {
                    candidates.push((0, path.clone()));
                } else if normalized_entry_name.contains(normalized_query) {
                    candidates.push((1, path.clone()));
                }
            }

            if file_type.is_dir()
                && !matches!(
                    normalized_entry_name.as_str(),
                    "node modules" | "git" | "appdata"
                )
            {
                collect_named_entries(
                    &path,
                    normalized_query,
                    remaining_depth - 1,
                    allowed_extensions,
                    candidates,
                );
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn open_windows_target_for_platform(_kind: &str, _query: &str) -> Result<OpenTargetResult, String> {
    Err("Opening applications and folders is only available on Windows.".to_string())
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn normalize_name(name: &str) -> String {
    name.chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::normalize_name;

    #[test]
    fn normalizes_spoken_target_names() {
        assert_eq!(normalize_name("  Job-Apply_folder! "), "job apply folder");
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "launches the locally installed Spotify application"]
    fn opens_spotify_smoke() {
        super::open_windows_target_for_platform("open_app", "Spotify")
            .expect("Spotify should open");
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "opens the local Job Apply folder in Explorer"]
    fn opens_job_apply_folder_smoke() {
        super::open_windows_target_for_platform("open_folder", "Job Apply")
            .expect("Job Apply folder should open");
    }
}
