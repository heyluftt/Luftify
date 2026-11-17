//! Second-order filter sections (RBJ Audio EQ Cookbook), shared by the
//! equalizer and the car cabin model.

#[derive(Clone, Copy, Debug)]
pub(crate) struct BiquadCoefficients {
    pub(crate) b0: f64,
    pub(crate) b1: f64,
    pub(crate) b2: f64,
    pub(crate) a1: f64,
    pub(crate) a2: f64,
}

impl BiquadCoefficients {
    fn normalized(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Self {
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }

    pub(crate) fn peak(sample_rate: f64, frequency_hz: f64, q: f64, gain_db: f64) -> Self {
        let (cosine, sine) = angle(sample_rate, frequency_hz);
        let amplitude = 10.0_f64.powf(gain_db / 40.0);
        let alpha = sine / (2.0 * q);
        Self::normalized(
            1.0 + alpha * amplitude,
            -2.0 * cosine,
            1.0 - alpha * amplitude,
            1.0 + alpha / amplitude,
            -2.0 * cosine,
            1.0 - alpha / amplitude,
        )
    }

    pub(crate) fn low_shelf(sample_rate: f64, frequency_hz: f64, slope: f64, gain_db: f64) -> Self {
        let (cosine, sine) = angle(sample_rate, frequency_hz);
        let a = 10.0_f64.powf(gain_db / 40.0);
        let two_root_alpha = 2.0 * a.sqrt() * shelf_alpha(sine, a, slope);
        Self::normalized(
            a * ((a + 1.0) - (a - 1.0) * cosine + two_root_alpha),
            2.0 * a * ((a - 1.0) - (a + 1.0) * cosine),
            a * ((a + 1.0) - (a - 1.0) * cosine - two_root_alpha),
            (a + 1.0) + (a - 1.0) * cosine + two_root_alpha,
            -2.0 * ((a - 1.0) + (a + 1.0) * cosine),
            (a + 1.0) + (a - 1.0) * cosine - two_root_alpha,
        )
    }

    pub(crate) fn high_shelf(
        sample_rate: f64,
        frequency_hz: f64,
        slope: f64,
        gain_db: f64,
    ) -> Self {
        let (cosine, sine) = angle(sample_rate, frequency_hz);
        let a = 10.0_f64.powf(gain_db / 40.0);
        let two_root_alpha = 2.0 * a.sqrt() * shelf_alpha(sine, a, slope);
        Self::normalized(
            a * ((a + 1.0) + (a - 1.0) * cosine + two_root_alpha),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * cosine),
            a * ((a + 1.0) + (a - 1.0) * cosine - two_root_alpha),
            (a + 1.0) - (a - 1.0) * cosine + two_root_alpha,
            2.0 * ((a - 1.0) - (a + 1.0) * cosine),
            (a + 1.0) - (a - 1.0) * cosine - two_root_alpha,
        )
    }
}

fn angle(sample_rate: f64, frequency_hz: f64) -> (f64, f64) {
    let frequency_hz = frequency_hz.clamp(1.0, sample_rate * 0.45);
    let omega = std::f64::consts::TAU * frequency_hz / sample_rate;
    (omega.cos(), omega.sin())
}

fn shelf_alpha(sine: f64, amplitude: f64, slope: f64) -> f64 {
    let slope = slope.clamp(0.1, 1.0);
    sine / 2.0
        * ((amplitude + 1.0 / amplitude) * (1.0 / slope - 1.0) + 2.0)
            .max(0.0)
            .sqrt()
}

/// Transposed direct form II state for one channel.
#[derive(Default, Clone, Copy)]
pub(crate) struct BiquadState {
    z1: f64,
    z2: f64,
}

impl BiquadState {
    pub(crate) fn process(&mut self, input: f64, coefficients: BiquadCoefficients) -> f64 {
        let output = coefficients.b0 * input + self.z1;
        self.z1 = coefficients.b1 * input - coefficients.a1 * output + self.z2;
        self.z2 = coefficients.b2 * input - coefficients.a2 * output;
        if self.z1.abs() < 1.0e-24 {
            self.z1 = 0.0;
        }
        if self.z2.abs() < 1.0e-24 {
            self.z2 = 0.0;
        }
        if output.is_finite() { output } else { 0.0 }
    }

    pub(crate) fn clear(&mut self) {
        *self = Self::default();
    }
}

/// Magnitude response in dB, for tests and tuning.
#[cfg(test)]
pub(crate) fn magnitude_db(
    coefficients: BiquadCoefficients,
    sample_rate: f64,
    frequency_hz: f64,
) -> f64 {
    let omega = std::f64::consts::TAU * frequency_hz / sample_rate;
    let (c1, s1) = (omega.cos(), omega.sin());
    let (c2, s2) = ((2.0 * omega).cos(), (2.0 * omega).sin());
    let numerator = (
        coefficients.b0 + coefficients.b1 * c1 + coefficients.b2 * c2,
        -(coefficients.b1 * s1 + coefficients.b2 * s2),
    );
    let denominator = (
        1.0 + coefficients.a1 * c1 + coefficients.a2 * c2,
        -(coefficients.a1 * s1 + coefficients.a2 * s2),
    );
    let power = (numerator.0.powi(2) + numerator.1.powi(2))
        / (denominator.0.powi(2) + denominator.1.powi(2));
    10.0 * power.log10()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shelves_and_peaks_reach_their_gain() {
        let rate = 48_000.0;
        let low = BiquadCoefficients::low_shelf(rate, 80.0, 0.8, 6.0);
        assert!((magnitude_db(low, rate, 20.0) - 6.0).abs() < 0.5);
        assert!(magnitude_db(low, rate, 2_000.0).abs() < 0.2);
        let high = BiquadCoefficients::high_shelf(rate, 6_000.0, 0.7, -4.0);
        assert!((magnitude_db(high, rate, 18_000.0) + 4.0).abs() < 0.6);
        assert!(magnitude_db(high, rate, 500.0).abs() < 0.2);
        let peak = BiquadCoefficients::peak(rate, 1_000.0, 1.4, 3.0);
        assert!((magnitude_db(peak, rate, 1_000.0) - 3.0).abs() < 0.01);
    }
}
