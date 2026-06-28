#[derive(serde::Serialize)]
pub struct ScreenCaptureResult {
    pub base64: String,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub monitor_id: u32,
    pub monitor_x: i32,
    pub monitor_y: i32,
    pub monitor_width: u32,
    pub monitor_height: u32,
    pub image_width: u32,
    pub image_height: u32,
}

#[tauri::command]
pub async fn capture_screen() -> Result<ScreenCaptureResult, String> {
    capture_screen_for_platform().await
}

fn calculate_resized_dimensions(width: u32, height: u32, max_width: u32) -> (u32, u32) {
    if width <= max_width {
        return (width, height);
    }

    let resized_height = ((height as f64 * max_width as f64) / width as f64).round() as u32;
    (max_width, resized_height.max(1))
}

fn convert_bgra_to_rgb(bgra: &[u8]) -> Result<Vec<u8>, String> {
    if !bgra.len().is_multiple_of(4) {
        return Err("Captured BGRA data did not contain complete pixels.".to_string());
    }

    Ok(bgra
        .chunks_exact(4)
        .flat_map(|pixel| [pixel[2], pixel[1], pixel[0]])
        .collect())
}

#[cfg(target_os = "windows")]
async fn capture_screen_for_platform() -> Result<ScreenCaptureResult, String> {
    tokio::task::spawn_blocking(capture_cursor_monitor)
        .await
        .map_err(|error| format!("Screen capture task failed: {error}"))?
}

#[cfg(target_os = "windows")]
fn capture_cursor_monitor() -> Result<ScreenCaptureResult, String> {
    use base64::Engine;
    use image::codecs::jpeg::JpegEncoder;
    use image::{DynamicImage, ImageBuffer, Rgb};
    use std::sync::{Arc, Mutex};
    use windows::Win32::Foundation::{POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
    use windows_capture::frame::Frame;
    use windows_capture::graphics_capture_api::InternalCaptureControl;
    use windows_capture::monitor::Monitor;
    use windows_capture::settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    };

    struct RawFrame {
        bgra: Vec<u8>,
        width: u32,
        height: u32,
    }

    struct OneShotCapture {
        shared_frame: Arc<Mutex<Option<RawFrame>>>,
    }

    impl GraphicsCaptureApiHandler for OneShotCapture {
        type Flags = Arc<Mutex<Option<RawFrame>>>;
        type Error = Box<dyn std::error::Error + Send + Sync>;

        fn new(context: Context<Self::Flags>) -> Result<Self, Self::Error> {
            Ok(Self {
                shared_frame: context.flags,
            })
        }

        fn on_frame_arrived(
            &mut self,
            frame: &mut Frame,
            capture_control: InternalCaptureControl,
        ) -> Result<(), Self::Error> {
            let width = frame.width();
            let height = frame.height();
            let mut frame_buffer = frame.buffer()?;
            let bgra = frame_buffer.as_nopadding_buffer()?.to_vec();
            let mut shared_frame = self
                .shared_frame
                .lock()
                .map_err(|_| "Screen capture frame lock was poisoned")?;
            *shared_frame = Some(RawFrame {
                bgra,
                width,
                height,
            });
            capture_control.stop();
            Ok(())
        }
    }

    let mut cursor = POINT::default();
    unsafe { GetCursorPos(&mut cursor).map_err(|error| error.to_string())? };
    let cursor_monitor = unsafe { MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST) };
    let monitors = Monitor::enumerate().map_err(|error| error.to_string())?;
    let monitor_id = monitors
        .iter()
        .position(|monitor| monitor.as_raw_hmonitor() == cursor_monitor.0)
        .ok_or_else(|| "Could not match the cursor to an enumerated monitor.".to_string())?;
    let target_monitor = monitors[monitor_id];

    let mut monitor_info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        rcMonitor: RECT::default(),
        rcWork: RECT::default(),
        dwFlags: 0,
    };
    unsafe {
        GetMonitorInfoW(
            HMONITOR(target_monitor.as_raw_hmonitor()),
            &mut monitor_info,
        )
        .ok()
        .map_err(|error| error.to_string())?;
    }

    let shared_frame = Arc::new(Mutex::new(None));
    let settings = Settings::new(
        target_monitor,
        CursorCaptureSettings::WithCursor,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        Arc::clone(&shared_frame),
    );
    OneShotCapture::start(settings).map_err(|error| error.to_string())?;

    let raw_frame = shared_frame
        .lock()
        .map_err(|_| "Screen capture frame lock was poisoned".to_string())?
        .take()
        .ok_or_else(|| "Screen capture stopped before producing a frame.".to_string())?;

    let rgb_bytes = convert_bgra_to_rgb(&raw_frame.bgra)?;
    let rgb_image =
        ImageBuffer::<Rgb<u8>, Vec<u8>>::from_raw(raw_frame.width, raw_frame.height, rgb_bytes)
            .ok_or_else(|| "Captured frame dimensions did not match its pixel data.".to_string())?;
    let mut image = DynamicImage::ImageRgb8(rgb_image);
    let (resized_width, resized_height) =
        calculate_resized_dimensions(image.width(), image.height(), 1280);
    if resized_width != image.width() {
        image = image.resize_exact(
            resized_width,
            resized_height,
            image::imageops::FilterType::Triangle,
        );
    }

    let image_width = image.width();
    let image_height = image.height();
    let mut jpeg_bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg_bytes, 75)
        .encode_image(&image)
        .map_err(|error| format!("Could not encode screenshot as JPEG: {error}"))?;

    let monitor_rect = monitor_info.rcMonitor;
    Ok(ScreenCaptureResult {
        base64: base64::engine::general_purpose::STANDARD.encode(jpeg_bytes),
        cursor_x: cursor.x,
        cursor_y: cursor.y,
        monitor_id: monitor_id as u32,
        monitor_x: monitor_rect.left,
        monitor_y: monitor_rect.top,
        monitor_width: (monitor_rect.right - monitor_rect.left) as u32,
        monitor_height: (monitor_rect.bottom - monitor_rect.top) as u32,
        image_width,
        image_height,
    })
}

#[cfg(test)]
mod tests {
    use super::{calculate_resized_dimensions, convert_bgra_to_rgb};

    #[test]
    fn preserves_small_screenshot_dimensions() {
        assert_eq!(calculate_resized_dimensions(1024, 768, 1280), (1024, 768));
    }

    #[test]
    fn resizes_wide_screenshot_proportionally() {
        assert_eq!(calculate_resized_dimensions(2560, 1440, 1280), (1280, 720));
    }

    #[test]
    fn converts_bgra_pixels_to_rgb() {
        assert_eq!(
            convert_bgra_to_rgb(&[10, 20, 30, 255, 40, 50, 60, 128]),
            Ok(vec![30, 20, 10, 60, 50, 40])
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "captures the active Windows desktop"]
    fn captures_current_monitor() {
        let capture = super::capture_cursor_monitor().expect("current monitor should be captured");
        assert!(!capture.base64.is_empty());
        assert!(capture.image_width <= 1280);
        assert!(capture.image_height > 0);
    }
}

#[cfg(not(target_os = "windows"))]
async fn capture_screen_for_platform() -> Result<ScreenCaptureResult, String> {
    Ok(ScreenCaptureResult {
        base64: String::new(),
        cursor_x: 0,
        cursor_y: 0,
        monitor_id: 0,
        monitor_x: 0,
        monitor_y: 0,
        monitor_width: 0,
        monitor_height: 0,
        image_width: 0,
        image_height: 0,
    })
}
