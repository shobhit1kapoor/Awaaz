use tauri::{App, Emitter, Manager};
use tauri_plugin_global_shortcut::{Builder, Code, Modifiers, ShortcutState};

pub const PUSH_TO_TALK_PRESSED_EVENT: &str = "push-to-talk-pressed";
pub const PUSH_TO_TALK_RELEASED_EVENT: &str = "push-to-talk-released";
pub const LISTENING_CANCELLED_EVENT: &str = "listening-cancelled";

pub fn setup_global_shortcut(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let plugin = Builder::new()
        .with_shortcuts(["ctrl+shift+space", "ctrl+shift+c", "ctrl+shift+x"])?
        .with_handler(|app_handle, shortcut, shortcut_event| {
            if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyC) {
                if shortcut_event.state == ShortcutState::Pressed {
                    toggle_panel(app_handle);
                }
                return;
            }

            if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyX) {
                if shortcut_event.state == ShortcutState::Pressed {
                    if let Err(error) = app_handle.emit(LISTENING_CANCELLED_EVENT, ()) {
                        eprintln!("Could not emit {LISTENING_CANCELLED_EVENT}: {error}");
                    }
                }
                return;
            }

            if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::Space) {
                let event_name = match shortcut_event.state {
                    ShortcutState::Pressed => PUSH_TO_TALK_PRESSED_EVENT,
                    ShortcutState::Released => PUSH_TO_TALK_RELEASED_EVENT,
                };
                if let Err(error) = app_handle.emit(event_name, ()) {
                    eprintln!("Could not emit {event_name}: {error}");
                }
            }
        })
        .build();

    app.handle().plugin(plugin)?;
    Ok(())
}

fn toggle_panel(app_handle: &tauri::AppHandle) {
    if let Some(panel_window) = app_handle.get_webview_window("panel") {
        let is_visible = panel_window.is_visible().unwrap_or(false);
        if is_visible {
            let _ = panel_window.hide();
        } else {
            let _ = panel_window.show();
            let _ = panel_window.set_focus();
        }
    }
}
