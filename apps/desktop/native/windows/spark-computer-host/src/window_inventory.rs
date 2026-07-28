#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Display {
    pub id: String,
    pub frame: Rect,
    pub pixel_width: u32,
    pub pixel_height: u32,
}

pub fn best_display(window: Rect, displays: &[Display]) -> Option<&Display> {
    displays
        .iter()
        .filter(|display| valid_rect(display.frame))
        .filter_map(|display| {
            let area = intersection_area(window, display.frame);
            (area > 0.0).then_some((display, area))
        })
        .max_by(|left, right| left.1.total_cmp(&right.1))
        .map(|(display, _)| display)
}

pub fn scale_factor(display: &Display) -> Option<f64> {
    if !valid_rect(display.frame) || display.pixel_width == 0 || display.pixel_height == 0 {
        return None;
    }
    let scale = f64::from(display.pixel_width) / display.frame.width;
    (scale.is_finite() && scale > 0.0 && scale <= 8.0).then_some(scale)
}

fn intersection_area(left: Rect, right: Rect) -> f64 {
    let width = 0.0_f64.max((left.x + left.width).min(right.x + right.width) - left.x.max(right.x));
    let height =
        0.0_f64.max((left.y + left.height).min(right.y + right.height) - left.y.max(right.y));
    width * height
}

fn valid_rect(rect: Rect) -> bool {
    rect.x.is_finite()
        && rect.y.is_finite()
        && rect.width.is_finite()
        && rect.height.is_finite()
        && rect.width > 0.0
        && rect.height > 0.0
        && rect.x.abs() <= 1_000_000.0
        && rect.y.abs() <= 1_000_000.0
        && rect.width <= 1_000_000.0
        && rect.height <= 1_000_000.0
}
