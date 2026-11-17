//! Anti-aliased 32px media glyphs for the Windows thumbnail toolbar.

pub const SIZE: usize = 32;
const SRC: usize = 64;

#[derive(Clone, Copy)]
pub enum Glyph {
    Previous,
    Play,
    Pause,
    Next,
}

/// Premultiplied BGRA pixels, top-down, `SIZE * SIZE` entries.
pub fn render(glyph: Glyph) -> Vec<u32> {
    let mut mask = vec![0u8; SRC * SRC];
    match glyph {
        Glyph::Previous => {
            fill_rect(&mut mask, 10.0, 14.0, 16.0, 50.0);
            fill_triangle(&mut mask, 50.0, 12.0, 50.0, 52.0, 18.0, 32.0);
        }
        Glyph::Play => {
            fill_triangle(&mut mask, 18.0, 12.0, 18.0, 52.0, 52.0, 32.0);
        }
        Glyph::Pause => {
            fill_rect(&mut mask, 18.0, 14.0, 28.0, 50.0);
            fill_rect(&mut mask, 36.0, 14.0, 46.0, 50.0);
        }
        Glyph::Next => {
            fill_triangle(&mut mask, 14.0, 12.0, 14.0, 52.0, 46.0, 32.0);
            fill_rect(&mut mask, 48.0, 14.0, 54.0, 50.0);
        }
    }
    downsample(&mask)
}

fn fill_rect(mask: &mut [u8], x0: f32, y0: f32, x1: f32, y1: f32) {
    let min_x = x0.min(x1).floor().max(0.0) as usize;
    let min_y = y0.min(y1).floor().max(0.0) as usize;
    let max_x = x0.max(x1).ceil().min(SRC as f32) as usize;
    let max_y = y0.max(y1).ceil().min(SRC as f32) as usize;
    for y in min_y..max_y {
        for x in min_x..max_x {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            if px >= x0.min(x1) && px < x0.max(x1) && py >= y0.min(y1) && py < y0.max(y1) {
                mask[y * SRC + x] = 255;
            }
        }
    }
}

fn fill_triangle(mask: &mut [u8], ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32) {
    let min_x = ax.min(bx).min(cx).floor().max(0.0) as usize;
    let min_y = ay.min(by).min(cy).floor().max(0.0) as usize;
    let max_x = ax.max(bx).max(cx).ceil().min(SRC as f32) as usize;
    let max_y = ay.max(by).max(cy).ceil().min(SRC as f32) as usize;
    for y in min_y..max_y {
        for x in min_x..max_x {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            if point_in_triangle(px, py, ax, ay, bx, by, cx, cy) {
                mask[y * SRC + x] = 255;
            }
        }
    }
}

fn point_in_triangle(
    px: f32,
    py: f32,
    ax: f32,
    ay: f32,
    bx: f32,
    by: f32,
    cx: f32,
    cy: f32,
) -> bool {
    let o1 = orient(px, py, ax, ay, bx, by);
    let o2 = orient(px, py, bx, by, cx, cy);
    let o3 = orient(px, py, cx, cy, ax, ay);
    (o1 >= 0.0 && o2 >= 0.0 && o3 >= 0.0) || (o1 <= 0.0 && o2 <= 0.0 && o3 <= 0.0)
}

fn orient(ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32) -> f32 {
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

fn downsample(mask: &[u8]) -> Vec<u32> {
    let mut out = vec![0u32; SIZE * SIZE];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let mut alpha = 0u16;
            for dy in 0..2 {
                for dx in 0..2 {
                    alpha += u16::from(mask[(y * 2 + dy) * SRC + (x * 2 + dx)]);
                }
            }
            let a = (alpha / 4) as u32;
            if a == 0 {
                continue;
            }
            // Ice-white glyph, premultiplied BGRA for a 32-bit DIB.
            let r = (248 * a) / 255;
            let g = (251 * a) / 255;
            let b = (255 * a) / 255;
            out[y * SIZE + x] = (a << 24) | (r << 16) | (g << 8) | b;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{Glyph, SIZE, render};

    fn alpha(pixel: u32) -> u8 {
        (pixel >> 24) as u8
    }

    fn sample(glyph: Glyph, x: usize, y: usize) -> u8 {
        alpha(render(glyph)[y * SIZE + x])
    }

    #[test]
    fn glyphs_are_32px_bgra() {
        for glyph in [Glyph::Previous, Glyph::Play, Glyph::Pause, Glyph::Next] {
            assert_eq!(render(glyph).len(), SIZE * SIZE);
        }
    }

    #[test]
    fn play_has_a_solid_core_and_empty_corners() {
        assert!(sample(Glyph::Play, 16, 16) > 180);
        assert_eq!(sample(Glyph::Play, 0, 0), 0);
        assert_eq!(sample(Glyph::Play, 31, 0), 0);
    }

    #[test]
    fn pause_is_two_bars() {
        assert!(sample(Glyph::Pause, 11, 16) > 180);
        assert!(sample(Glyph::Pause, 20, 16) > 180);
        assert!(sample(Glyph::Pause, 16, 16) < 40);
    }

    #[test]
    fn skip_glyphs_include_a_leading_bar() {
        assert!(sample(Glyph::Previous, 6, 16) > 180);
        assert!(sample(Glyph::Next, 25, 16) > 180);
    }
}
