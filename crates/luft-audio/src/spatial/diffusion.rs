use super::*;

pub(super) struct StereoDiffuser {
    left_first: AllpassDiffuser,
    left_second: AllpassDiffuser,
    left_third: AllpassDiffuser,
    left_fourth: AllpassDiffuser,
    right_first: AllpassDiffuser,
    right_second: AllpassDiffuser,
    right_third: AllpassDiffuser,
    right_fourth: AllpassDiffuser,
}

impl StereoDiffuser {
    pub(super) fn new(sample_rate: f64) -> Self {
        Self {
            left_first: AllpassDiffuser::new(milliseconds_to_samples(sample_rate, 4.7), 0.63),
            left_second: AllpassDiffuser::new(milliseconds_to_samples(sample_rate, 7.3), 0.61),
            left_third: AllpassDiffuser::new(milliseconds_to_samples(sample_rate, 10.1), 0.57),
            left_fourth: AllpassDiffuser::new(milliseconds_to_samples(sample_rate, 12.7), 0.53),
            right_first: AllpassDiffuser::new(milliseconds_to_samples(sample_rate, 5.3), 0.62),
            right_second: AllpassDiffuser::new(milliseconds_to_samples(sample_rate, 6.1), 0.60),
            right_third: AllpassDiffuser::new(milliseconds_to_samples(sample_rate, 9.1), 0.56),
            right_fourth: AllpassDiffuser::new(milliseconds_to_samples(sample_rate, 13.3), 0.52),
        }
    }

    pub(super) fn process(&mut self, left: f64, right: f64) -> (f64, f64) {
        let left = self.left_first.process(left);
        let left = self.left_second.process(left);
        let left = self.left_third.process(left);
        let left = self.left_fourth.process(left);
        let right = self.right_first.process(right);
        let right = self.right_second.process(right);
        let right = self.right_third.process(right);
        let right = self.right_fourth.process(right);
        (left, right)
    }

    pub(super) fn clear(&mut self) {
        self.left_first.clear();
        self.left_second.clear();
        self.left_third.clear();
        self.left_fourth.clear();
        self.right_first.clear();
        self.right_second.clear();
        self.right_third.clear();
        self.right_fourth.clear();
    }
}

pub(super) struct AllpassDiffuser {
    buffer: Vec<f64>,
    index: usize,
    coefficient: f64,
}

impl AllpassDiffuser {
    pub(super) fn new(length: usize, coefficient: f64) -> Self {
        Self {
            buffer: vec![0.0; length.max(1)],
            index: 0,
            coefficient,
        }
    }

    pub(super) fn process(&mut self, input: f64) -> f64 {
        let delayed = self.buffer[self.index];
        let output = delayed - self.coefficient * input;
        self.buffer[self.index] = finite_sample(input + self.coefficient * output);
        self.index = (self.index + 1) % self.buffer.len();
        finite_sample(output)
    }

    pub(super) fn clear(&mut self) {
        self.buffer.fill(0.0);
        self.index = 0;
    }
}
