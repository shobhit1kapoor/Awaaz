use tauri::{App, Emitter};
use tauri_plugin_global_shortcut::{Builder, ShortcutState};

pub const PUSH_TO_TALK_PRESSED_EVENT: &str = "push-to-talk-pressed";
pub const PUSH_TO_TALK_RELEASED_EVENT: &str = "push-to-talk-released";

pub fn setup_global_shortcut(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let plugin = Builder::new()
        .with_shortcuts(["ctrl+shift+space"])?
        .with_handler(|app_handle, _shortcut, shortcut_event| {
            let event_name = match shortcut_event.state {
                ShortcutState::Pressed => PUSH_TO_TALK_PRESSED_EVENT,
                ShortcutState::Released => PUSH_TO_TALK_RELEASED_EVENT,
            };
            if let Err(error) = app_handle.emit(event_name, ()) {
                eprintln!("Could not emit {event_name}: {error}");
            }
        })
        .build();

    app.handle().plugin(plugin)?;
    Ok(())
}
