use super::*;

/// Below this the loop keeps its own decay (warmth, see `bass_ratio`).
const BASS_SPLIT_HZ: f64 = 260.0;

pub(super) struct FdnReverb {
    lines: [DelayLine; FDN_LINE_COUNT],
    damping_state: [f64; FDN_LINE_COUNT],
    bass_state: [f64; FDN_LINE_COUNT],
    bass_alpha: f64,
}

impl FdnReverb {
    pub(super) fn new(sample_rate: f64) -> Self {
        Self {
            lines: std::array::from_fn(|index| {
                let delay_samples = FDN_DELAY_SECONDS[index] * sample_rate;
                DelayLine::new(delay_samples.max(3.0), sample_rate, index)
            }),
            damping_state: [0.0; FDN_LINE_COUNT],
            bass_state: [0.0; FDN_LINE_COUNT],
            bass_alpha: one_pole_alpha(sample_rate, BASS_SPLIT_HZ),
        }
    }

    pub(super) fn process(
        &mut self,
        left: f64,
        right: f64,
        damping_alpha: f64,
        feedback: [f64; FDN_LINE_COUNT],
        bass_boost: [f64; FDN_LINE_COUNT],
        room_scale: f64,
    ) -> (f64, f64) {
        let mut outputs = [0.0; FDN_LINE_COUNT];
        for (output, line) in outputs.iter_mut().zip(&mut self.lines) {
            *output = line.read_modulated(room_scale);
        }
        let mut damped = [0.0; FDN_LINE_COUNT];
        for index in 0..FDN_LINE_COUNT {
            self.damping_state[index] +=
                damping_alpha * (outputs[index] - self.damping_state[index]);
            // Bass loses less per pass than the mids: a hall's warm tail.
            self.bass_state[index] +=
                self.bass_alpha * (self.damping_state[index] - self.bass_state[index]);
            damped[index] =
                self.damping_state[index] + self.bass_state[index] * (bass_boost[index] - 1.0);
        }
        let mixed = normalized_hadamard(damped);
        let injection = [
            left,
            right,
            left - right,
            right - left,
            left * 0.72 + right * 0.28,
            right * 0.72 + left * 0.28,
            left - right * 0.46,
            right - left * 0.46,
        ];
        for index in 0..FDN_LINE_COUNT {
            self.lines[index]
                .push(injection[index] * REVERB_INPUT_GAIN + mixed[index] * feedback[index]);
        }

        let wet_left = (outputs[0] + outputs[2] * 0.86 + outputs[5] * 0.28 - outputs[7] * 0.42)
            * REVERB_OUTPUT_GAIN;
        let wet_right = (outputs[1] + outputs[3] * 0.86 + outputs[4] * 0.28 - outputs[6] * 0.42)
            * REVERB_OUTPUT_GAIN;
        (wet_left, wet_right)
    }

    pub(super) fn clear(&mut self) {
        for line in &mut self.lines {
            line.clear();
        }
        self.damping_state = [0.0; FDN_LINE_COUNT];
        self.bass_state = [0.0; FDN_LINE_COUNT];
    }
}

pub(super) struct DelayLine {
    buffer: Vec<f64>,
    write_index: usize,
    base_delay_samples: f64,
    modulation_depth_samples: f64,
    phase: f64,
    phase_step: f64,
}

impl DelayLine {
    pub(super) fn new(base_delay_samples: f64, sample_rate: f64, line_index: usize) -> Self {
        let modulation_depth_samples = sample_rate * FDN_MODULATION_MS[line_index] / 1_000.0;
        let length =
            (base_delay_samples * MAX_ROOM_SCALE + modulation_depth_samples).ceil() as usize + 4;
        Self {
            buffer: vec![0.0; length],
            write_index: 0,
            base_delay_samples,
            modulation_depth_samples,
            phase: std::f64::consts::TAU * line_index as f64 / FDN_LINE_COUNT as f64,
            phase_step: std::f64::consts::TAU * FDN_MODULATION_HZ[line_index] / sample_rate,
        }
    }

    pub(super) fn read_modulated(&mut self, room_scale: f64) -> f64 {
        let scale = room_scale.clamp(0.55, MAX_ROOM_SCALE);
        let delay = (self.base_delay_samples * scale
            + self.modulation_depth_samples * self.phase.sin())
        .clamp(1.0, (self.buffer.len() - 2) as f64);
        let read_position = (self.write_index as f64 - delay).rem_euclid(self.buffer.len() as f64);
        let first = read_position.floor() as usize;
        let second = (first + 1) % self.buffer.len();
        let fraction = read_position - first as f64;
        let sample = self.buffer[first] + (self.buffer[second] - self.buffer[first]) * fraction;

        self.phase += self.phase_step;
        if self.phase >= std::f64::consts::TAU {
            self.phase -= std::f64::consts::TAU;
        }
        sample
    }

    pub(super) fn push(&mut self, sample: f64) {
        self.buffer[self.write_index] = finite_sample(sample);
        self.write_index += 1;
        if self.write_index == self.buffer.len() {
            self.write_index = 0;
        }
    }

    pub(super) fn clear(&mut self) {
        self.buffer.fill(0.0);
        self.write_index = 0;
    }
}

pub(super) fn normalized_hadamard(mut values: [f64; FDN_LINE_COUNT]) -> [f64; FDN_LINE_COUNT] {
    let mut stride = 1;
    while stride < FDN_LINE_COUNT {
        let mut block = 0;
        while block < FDN_LINE_COUNT {
            for offset in 0..stride {
                let first = values[block + offset];
                let second = values[block + offset + stride];
                values[block + offset] = first + second;
                values[block + offset + stride] = first - second;
            }
            block += stride * 2;
        }
        stride *= 2;
    }
    let normalization = 1.0 / (FDN_LINE_COUNT as f64).sqrt();
    for value in &mut values {
        *value *= normalization;
    }
    values
}
