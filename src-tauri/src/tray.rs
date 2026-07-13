use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Manager};

pub fn setup_tray(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let show_clicky_item =
        MenuItem::with_id(app, "show-clicky", "Show Clicky", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let tray_menu = Menu::with_items(app, &[&show_clicky_item, &settings_item, &quit_item])?;

    let mut tray_builder = TrayIconBuilder::new()
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .tooltip("Clicky")
        .on_tray_icon_event(|tray_icon, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(panel_window) = tray_icon.app_handle().get_webview_window("panel") {
                    let is_visible = panel_window.is_visible().unwrap_or(false);
                    if is_visible {
                        let _ = panel_window.hide();
                    } else {
                        let _ = panel_window.show();
                        let _ = panel_window.set_focus();
                    }
                }
            }
        })
        .on_menu_event(|app_handle, event| match event.id.as_ref() {
            "quit" => app_handle.exit(0),
            "settings" | "show-clicky" => {
                if let Some(panel_window) = app_handle.get_webview_window("panel") {
                    let _ = panel_window.show();
                    let _ = panel_window.set_focus();
                }
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }

    tray_builder.build(app)?;

    Ok(())
}
