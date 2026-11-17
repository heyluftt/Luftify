pub(super) struct VariableStereoDelay {
    left: Vec<f64>,
    right: Vec<f64>,
    write_index: usize,
}

impl VariableStereoDelay {
    pub(super) fn new(length: usize) -> Self {
        Self {
            left: vec![0.0; length],
            right: vec![0.0; length],
            write_index: 0,
        }
    }

    pub(super) fn process(&mut self, left: f64, right: f64, delay_samples: f64) -> (f64, f64) {
        self.left[self.write_index] = left;
        self.right[self.write_index] = right;
        let maximum_delay = (self.left.len() - 2) as f64;
        let delay = delay_samples.clamp(0.0, maximum_delay);
        let length = self.left.len() as f64;
        let read_position = (self.write_index as f64 - delay).rem_euclid(length);
        let first = read_position.floor() as usize;
        let second = (first + 1) % self.left.len();
        let fraction = read_position - first as f64;
        let delayed_left = self.left[first] + (self.left[second] - self.left[first]) * fraction;
        let delayed_right = self.right[first] + (self.right[second] - self.right[first]) * fraction;
        self.write_index = (self.write_index + 1) % self.left.len();
        (delayed_left, delayed_right)
    }

    pub(super) fn clear(&mut self) {
        self.left.fill(0.0);
        self.right.fill(0.0);
        self.write_index = 0;
    }
}
