//! The rooms behind the room presets: shoebox halls with a stage and a seat.
//! Early reflections come from an image-source model of these rooms, so a
//! studio answers within a few milliseconds from close walls, while a
//! concert hall sends lateral reflections after an initial gap and a large
//! stone hall lets them arrive late and dark. The decay control walks along
//! these rooms continuously; the presets sit on the anchors.

const SPEED_OF_SOUND: f64 = 343.0;
/// Far-ear delay for a reflection arriving fully from the side (Woodworth).
const MAX_INTERAURAL_SECONDS: f64 = 0.000_66;
/// Beyond this a reflection belongs to the late reverb, not to the room's
/// first answer; letting it through as a single tap sounds like an echo.
const FADE_START_SECONDS: f64 = 0.075;
const FADE_END_SECONDS: f64 = 0.14;
/// Reflections this close to the direct sound fuse with it (the floor
/// bounce in a hall); the dry path already carries them.
const FUSION_SECONDS: f64 = 0.002;
pub(super) const IMAGE_COUNT: usize = 24;
pub(super) const LONGEST_TAP_SECONDS: f64 = FADE_END_SECONDS + MAX_INTERAURAL_SECONDS;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct RoomShape {
    /// Length (stage to back wall), width, height in metres.
    pub size: [f64; 3],
    /// Seat distance from the stage.
    pub listener_distance: f64,
    /// Half the distance between the left and right source on stage.
    pub stage_spread: f64,
    /// Mean energy absorption of the walls (0 = mirror, 1 = open window).
    pub absorption: f64,
    /// The floor apart: seats and audience swallow the grazing floor
    /// bounce, which would otherwise comb-filter the direct sound.
    pub floor_absorption: f64,
    /// Low-frequency decay relative to the mids (warmth of a hall).
    pub bass_ratio: f64,
}

/// (decay control in seconds, room). The presets use these decay values.
const ANCHORS: [(f64, RoomShape); 6] = [
    // Vocal booth: dead, tight.
    (
        0.35,
        RoomShape {
            size: [3.2, 2.6, 2.4],
            listener_distance: 1.1,
            stage_spread: 0.5,
            absorption: 0.55,
            floor_absorption: 0.3,
            bass_ratio: 1.0,
        },
    ),
    // Studio live room: close walls, lively but treated.
    (
        0.8,
        RoomShape {
            size: [7.5, 5.6, 3.4],
            listener_distance: 2.4,
            stage_spread: 1.1,
            absorption: 0.34,
            floor_absorption: 0.15,
            bass_ratio: 1.0,
        },
    ),
    // Chamber / recital room: wood, a few rows.
    (
        1.5,
        RoomShape {
            size: [15.0, 9.5, 6.5],
            listener_distance: 6.0,
            stage_spread: 2.0,
            absorption: 0.22,
            floor_absorption: 0.6,
            bass_ratio: 1.08,
        },
    ),
    // Shoebox concert hall (Musikverein-like proportions), middle stalls.
    (
        2.4,
        RoomShape {
            size: [46.0, 20.0, 17.0],
            listener_distance: 17.0,
            stage_spread: 4.0,
            absorption: 0.15,
            floor_absorption: 0.85,
            bass_ratio: 1.2,
        },
    ),
    // Large stone hall, far back.
    (
        4.2,
        RoomShape {
            size: [72.0, 32.0, 24.0],
            listener_distance: 30.0,
            stage_spread: 5.5,
            absorption: 0.08,
            floor_absorption: 0.7,
            bass_ratio: 1.26,
        },
    ),
    // Cathedral nave.
    (
        5.5,
        RoomShape {
            size: [88.0, 36.0, 30.0],
            listener_distance: 36.0,
            stage_spread: 6.0,
            absorption: 0.06,
            floor_absorption: 0.7,
            bass_ratio: 1.3,
        },
    ),
];

pub(super) fn room_shape(decay_seconds: f64) -> RoomShape {
    let decay = decay_seconds.clamp(ANCHORS[0].0, ANCHORS[ANCHORS.len() - 1].0);
    let upper = ANCHORS
        .iter()
        .position(|(anchor, _)| *anchor >= decay)
        .unwrap_or(ANCHORS.len() - 1)
        .max(1);
    let (low_decay, low) = ANCHORS[upper - 1];
    let (high_decay, high) = ANCHORS[upper];
    let t = ((decay - low_decay) / (high_decay - low_decay)).clamp(0.0, 1.0);
    // Sizes grow geometrically; halfway between a studio and a hall is not
    // their arithmetic mean.
    let geometric = |a: f64, b: f64| a * (b / a).powf(t);
    let linear = |a: f64, b: f64| a + (b - a) * t;
    RoomShape {
        size: std::array::from_fn(|axis| geometric(low.size[axis], high.size[axis])),
        listener_distance: geometric(low.listener_distance, high.listener_distance),
        stage_spread: linear(low.stage_spread, high.stage_spread),
        absorption: linear(low.absorption, high.absorption),
        floor_absorption: linear(low.floor_absorption, high.floor_absorption),
        bass_ratio: linear(low.bass_ratio, high.bass_ratio),
    }
}

/// One reflection as heard at both ears.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(super) struct Tap {
    /// After the direct sound of the same source, per ear.
    pub delay_seconds: [f64; 2],
    pub gain: [f64; 2],
    /// Share of treble that survives walls, air and the head, per ear.
    pub brightness: [f64; 2],
}

/// All first- and second-order reflections of one stage source
/// (`side` -1 = left, +1 = right), in a fixed wall order so that taps glide
/// instead of jumping when the room changes size.
pub(super) fn image_taps(shape: &RoomShape, side: f64) -> [Tap; IMAGE_COUNT] {
    let [length, width, _] = shape.size;
    let stage_x = (length * 0.12).clamp(1.0, 4.0);
    // Facing the stage (-x), the listener's left is -y.
    let source = [stage_x, width * 0.5 + side * shape.stage_spread, 1.6];
    let listener = [
        (stage_x + shape.listener_distance).min(length - 0.8),
        width * 0.5 - width * 0.06,
        1.2,
    ];
    let direct = distance(source, listener);
    let reflection = (1.0 - shape.absorption).sqrt();
    let floor = (1.0 - shape.floor_absorption).sqrt() / reflection;
    let mut taps = [Tap::default(); IMAGE_COUNT];
    for (tap, (reflections, floor_hits, image)) in taps.iter_mut().zip(images(source, shape.size)) {
        let path = distance(image, listener);
        let delay = (path - direct).max(0.0) / SPEED_OF_SOUND;
        let fade = if delay < FUSION_SECONDS {
            let x = delay / FUSION_SECONDS;
            x * x
        } else if delay <= FADE_START_SECONDS {
            1.0
        } else {
            let x =
                ((delay - FADE_START_SECONDS) / (FADE_END_SECONDS - FADE_START_SECONDS)).min(1.0);
            (1.0 - x) * (1.0 - x)
        };
        let gain = direct / path * reflection.powi(reflections) * floor.powi(floor_hits) * fade;
        // Positive: arriving from the listener's left.
        let lateral = -(image[1] - listener[1]) / path;
        let itd = MAX_INTERAURAL_SECONDS * lateral.abs();
        // Air absorbs treble over long paths, every wall a little more.
        let surface = 1.0 / (1.0 + 0.3 * f64::from(reflections) + path / 70.0);
        let shadow = 1.0 - 0.45 * lateral.abs();
        let left_far = lateral < 0.0;
        *tap = Tap {
            delay_seconds: [
                delay + if left_far { itd } else { 0.0 },
                delay + if left_far { 0.0 } else { itd },
            ],
            gain: [
                gain * (1.0 + 0.7 * lateral).sqrt(),
                gain * (1.0 - 0.7 * lateral).sqrt(),
            ],
            brightness: [
                surface * if left_far { shadow } else { 1.0 },
                surface * if left_far { 1.0 } else { shadow },
            ],
        };
    }
    taps
}

/// Image sources with one or two reflections: per axis the source itself,
/// its mirror in either wall, or a double mirror across both.
/// Yields (reflections, floor hits, position).
fn images(source: [f64; 3], size: [f64; 3]) -> impl Iterator<Item = (i32, i32, [f64; 3])> {
    // (reflections, hits of the wall at 0, coordinate) for one axis; for the
    // height axis the wall at 0 is the floor.
    let choices = move |axis: usize| {
        let (s, d) = (source[axis], size[axis]);
        [
            (0, 0, s),
            (1, 1, -s),
            (1, 0, 2.0 * d - s),
            (2, 1, 2.0 * d + s),
            (2, 1, s - 2.0 * d),
        ]
    };
    let (x, y, z) = (choices(0), choices(1), choices(2));
    x.into_iter().flat_map(move |(rx, _, px)| {
        y.into_iter().flat_map(move |(ry, _, py)| {
            z.into_iter().filter_map(move |(rz, floor, pz)| {
                let count = rx + ry + rz;
                (1..=2)
                    .contains(&count)
                    .then_some((count, floor, [px, py, pz]))
            })
        })
    })
}

fn distance(a: [f64; 3], b: [f64; 3]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn taps(shape: &RoomShape) -> Vec<Tap> {
        [-1.0, 1.0]
            .iter()
            .flat_map(|side| image_taps(shape, *side))
            .collect()
    }

    /// Arrival of the first reflection at least half as strong as the strongest.
    fn first_strong(shape: &RoomShape) -> f64 {
        let taps = taps(shape);
        let strongest = taps.iter().map(|tap| tap.gain[0]).fold(0.0, f64::max);
        taps.iter()
            .filter(|tap| tap.gain[0] >= strongest * 0.5)
            .map(|tap| tap.delay_seconds[0])
            .fold(f64::INFINITY, f64::min)
    }

    /// Energy-weighted arrival time of the early field.
    fn centre_time(shape: &RoomShape) -> f64 {
        let taps = taps(shape);
        let energy: f64 = taps.iter().map(|tap| tap.gain[0].powi(2)).sum();
        taps.iter()
            .map(|tap| tap.gain[0].powi(2) * tap.delay_seconds[0])
            .sum::<f64>()
            / energy
    }

    #[test]
    fn every_source_has_all_first_and_second_order_images() {
        assert_eq!(
            images([1.0, 2.0, 1.5], [7.0, 5.0, 3.0]).count(),
            IMAGE_COUNT
        );
    }

    #[test]
    fn rooms_answer_later_as_they_grow() {
        let centres = [0.8, 1.5, 2.4, 4.2].map(|decay| centre_time(&room_shape(decay)));
        assert!(
            centres.windows(2).all(|pair| pair[1] > pair[0] * 1.1),
            "{centres:?}"
        );
        assert!(first_strong(&room_shape(0.8)) < 0.006);
        // A good hall seat: the initial time delay gap of well-liked halls.
        let gap = first_strong(&room_shape(2.4));
        assert!((0.010..0.035).contains(&gap), "hall gap {gap}");
    }

    #[test]
    fn a_left_source_is_louder_and_earlier_at_the_left_ear() {
        let taps = image_taps(&room_shape(2.4), -1.0);
        let energy = |ear: usize| taps.iter().map(|tap| tap.gain[ear].powi(2)).sum::<f64>();
        assert!(energy(0) > energy(1));
    }

    #[test]
    fn the_decay_control_moves_the_room_continuously() {
        let a = room_shape(2.39);
        let b = room_shape(2.41);
        assert!((a.size[0] / b.size[0] - 1.0).abs() < 0.03);
        let anchor = room_shape(2.4);
        assert!((anchor.size[0] - ANCHORS[3].1.size[0]).abs() < 1.0e-9);
    }
}
