//! Audio device output for Libre.
//!
//! Librespot's own Rodio sink opens the device as 16-bit and lets Rodio
//! convert 44.1 kHz to the device rate by linear interpolation. Windows
//! devices usually run at 48 kHz, so every track lost treble on the way
//! out. This sink opens the device in float, prefers a native 44.1 kHz
//! mode and otherwise converts with `StereoResampler` before Rodio sees the
//! audio, so Rodio never resamples.
//! Every buffer plays through one shared fade (`output_fade.rs`), so a
//! skip, seek or pause is heard at once and without a click.
use std::{
    collections::VecDeque,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use cpal::traits::{DeviceTrait, HostTrait};
use librespot::playback::{
    NUM_CHANNELS, SAMPLE_RATE,
    audio_backend::{Sink, SinkError, SinkResult},
    convert::Converter,
    decoder::AudioPacket,
};
use luft_audio::{StereoResampler, VisualizerControl};
use tracing::{info, warn};

use crate::output_fade::{FADE_OUT, Fade, Faded};

/// About half a second of queued audio, as in Librespot's Rodio sink.
const MAX_QUEUED_BUFFERS: usize = 26;
/// WASAPI shared-mode period plus mixing; not observable through cpal.
const DEVICE_BUFFER: Duration = Duration::from_millis(15);
/// A fade-out is waited for at most this much longer than it lasts.
const FADE_GRACE: Duration = Duration::from_millis(60);
/// Dry runs are counted; one is logged at most this often.
const DRY_LOG_INTERVAL: Duration = Duration::from_secs(10);

/// Audio handed to the device since start, in source frames (44.1 kHz), and how
/// much of it still waited in the queue at the last write. Together: how far
/// the listener really got, e.g. while a dropped session's player plays on
/// from its buffer (session_runtime.rs). One output per app, so shared.
static WRITTEN_FRAMES: AtomicU64 = AtomicU64::new(0);
static QUEUED_MS: AtomicU64 = AtomicU64::new(0);

/// Milliseconds of audio that reached the speaker since start (roughly: what
/// was written minus what still waited).
pub(crate) fn heard_ms() -> u64 {
    let written = WRITTEN_FRAMES.load(Ordering::Relaxed).saturating_mul(1000) / u64::from(SAMPLE_RATE);
    written.saturating_sub(QUEUED_MS.load(Ordering::Relaxed))
}

pub(crate) struct DeviceSink {
    sink: rodio::Sink,
    _stream: rodio::OutputStream,
    rate: u32,
    resampler: Option<StereoResampler>,
    converted: Vec<f32>,
    /// Frames of each buffer still queued in Rodio, oldest first.
    queued: VecDeque<usize>,
    /// Learns how far the speaker lags behind the analysed audio.
    latency: VisualizerControl,
    fade: Arc<Fade>,
    /// A cut whose rest of the queue is not dropped yet.
    cut_at: Option<Instant>,
    /// The last write of audio that was meant to play on; `None` after a
    /// cut, stop or (re)start, when the queue is empty on purpose.
    last_write: Option<Instant>,
    dry_runs: u64,
    dry_logged_at: Option<Instant>,
}

impl DeviceSink {
    pub(crate) fn open(
        device_name: Option<&str>,
        latency: VisualizerControl,
    ) -> Result<Self, String> {
        let host = cpal::default_host();
        let device = match device_name {
            Some(name) => host
                .output_devices()
                .map_err(|error| error.to_string())?
                .find(|device| device.name().ok().as_deref() == Some(name))
                .ok_or_else(|| format!("audio device {name} is not available"))?,
            None => host
                .default_output_device()
                .ok_or_else(|| "no default audio device".to_string())?,
        };
        let default_config = device
            .default_output_config()
            .map_err(|error| error.to_string())?;
        let stereo = device
            .supported_output_configs()
            .map_err(|error| error.to_string())?
            .find(|config| config.channels() == cpal::ChannelCount::from(NUM_CHANNELS));
        // Native 44.1 kHz avoids conversion entirely; otherwise the device's own rate.
        let config = stereo
            .and_then(|config| {
                config
                    .try_with_sample_rate(cpal::SampleRate(SAMPLE_RATE))
                    .or_else(|| config.try_with_sample_rate(default_config.sample_rate()))
            })
            .unwrap_or(default_config);
        let mut stream = match rodio::OutputStreamBuilder::default()
            .with_device(device.clone())
            .with_config(&config.config())
            .with_sample_format(cpal::SampleFormat::F32)
            .open_stream()
        {
            Ok(stream) => stream,
            Err(error) => {
                warn!(adapter = "librespot", %error, "float output refused, using the device default");
                rodio::OutputStreamBuilder::from_device(device)
                    .and_then(|builder| builder.open_stream_or_fallback())
                    .map_err(|error| error.to_string())?
            }
        };
        stream.log_on_drop(false);
        let rate = stream.config().sample_rate();
        let resampler = StereoResampler::new(SAMPLE_RATE, rate);
        info!(
            adapter = "librespot",
            device = device_name.unwrap_or("windows-default"),
            device_rate = rate,
            device_channels = stream.config().channel_count(),
            sample_format = ?stream.config().sample_format(),
            resampling = resampler.is_some(),
            "audio output opened"
        );
        Ok(Self {
            sink: rodio::Sink::connect_new(stream.mixer()),
            _stream: stream,
            rate,
            resampler,
            converted: Vec::new(),
            queued: VecDeque::with_capacity(MAX_QUEUED_BUFFERS + 4),
            latency,
            fade: Fade::new(),
            cut_at: None,
            last_write: None,
            dry_runs: 0,
            dry_logged_at: None,
        })
    }

    /// Device frames written but not heard yet.
    fn pending_frames(&mut self) -> usize {
        while self.queued.len() > self.sink.len() {
            self.queued.pop_front();
        }
        let pending: usize = self.queued.iter().sum();
        let played = (self.sink.get_pos().as_secs_f64() * f64::from(self.rate)) as usize;
        let played = played.min(self.queued.front().copied().unwrap_or(0));
        pending.saturating_sub(played)
    }

    /// Time until the newest written sample reaches the speaker.
    fn report_latency(&mut self) {
        let frames = self.pending_frames();
        let waiting = Duration::from_secs_f64(frames as f64 / f64::from(self.rate)) + DEVICE_BUFFER;
        QUEUED_MS.store(waiting.as_millis() as u64, Ordering::Relaxed);
        self.latency.set_output_latency(waiting);
    }

    /// The audio thread runs the fade; it ends early if the queue runs dry.
    fn wait_until_faded(&self, since: Instant) {
        let deadline = since + FADE_OUT + FADE_GRACE;
        while !self.fade.is_silent()
            && !self.sink.empty()
            && !self.sink.is_paused()
            && Instant::now() < deadline
        {
            thread::sleep(Duration::from_millis(2));
        }
    }

    /// Drops what is left before a cut, once it has faded out.
    fn finish_cut(&mut self) {
        let Some(since) = self.cut_at.take() else {
            return;
        };
        self.wait_until_faded(since);
        // Dropped audio was never heard (see `heard_ms`).
        let dropped = self.pending_frames() as u64 * u64::from(SAMPLE_RATE) / u64::from(self.rate);
        // Only this thread writes the counter.
        WRITTEN_FRAMES.fetch_sub(dropped.min(WRITTEN_FRAMES.load(Ordering::Relaxed)), Ordering::Relaxed);
        let paused = self.sink.is_paused();
        self.sink.clear();
        if !paused {
            self.sink.play();
        }
        self.fade.silence();
        self.forget_queue();
    }

    /// The queue ran dry between two writes: the speaker fell silent while
    /// the decoder had nothing ready (download stall, busy machine), or the
    /// next song's load took longer than the previous one's tail. Logged so
    /// the logs show whether and when that happens.
    fn note_dry_run(&mut self) {
        let Some(last) = self.last_write.take() else {
            return;
        };
        if self.queued.is_empty() || !self.sink.empty() || self.sink.is_paused() {
            return;
        }
        let Some(silence) = silence_after(last.elapsed(), Duration::from_millis(QUEUED_MS.load(Ordering::Relaxed))) else {
            return;
        };
        self.dry_runs += 1;
        if self.dry_logged_at.is_some_and(|at| at.elapsed() < DRY_LOG_INTERVAL) {
            return;
        }
        self.dry_logged_at = Some(Instant::now());
        warn!(
            adapter = "librespot",
            phase = "audio-dry",
            silence_ms = silence.as_millis() as u64,
            dry_runs = self.dry_runs,
            "audio queue ran dry before the next packet"
        );
    }

    fn forget_queue(&mut self) {
        self.last_write = None;
        self.queued.clear();
        QUEUED_MS.store(0, Ordering::Relaxed);
        self.latency.set_output_latency(DEVICE_BUFFER);
        // The next audio (seek, new track) must not continue an old waveform.
        if let Some(resampler) = &mut self.resampler {
            resampler.reset();
        }
    }
}

impl Sink for DeviceSink {
    fn start(&mut self) -> SinkResult<()> {
        self.finish_cut();
        self.fade.rise();
        self.sink.play();
        // A resume plays the kept queue; its silence was the pause.
        self.last_write = None;
        Ok(())
    }

    fn stop(&mut self) -> SinkResult<()> {
        self.finish_cut();
        if self.sink.is_paused() {
            // Paused softly: nothing would play the queue out.
            self.sink.clear();
        } else {
            self.sink.sleep_until_end();
        }
        self.sink.pause();
        self.fade.silence();
        self.forget_queue();
        Ok(())
    }

    fn cut(&mut self) -> SinkResult<()> {
        self.fade.fall();
        self.cut_at = Some(Instant::now());
        // Paused or empty, nothing is audible: drop the rest right away.
        if self.sink.is_paused() || self.sink.empty() {
            self.finish_cut();
        }
        Ok(())
    }

    fn pause_softly(&mut self) -> SinkResult<()> {
        self.finish_cut();
        self.fade.fall();
        self.wait_until_faded(Instant::now());
        self.sink.pause();
        self.fade.silence();
        Ok(())
    }

    fn write(&mut self, packet: AudioPacket, converter: &mut Converter) -> SinkResult<()> {
        self.finish_cut();
        self.note_dry_run();
        self.fade.rise();
        let samples = packet
            .samples()
            .map_err(|error| SinkError::OnWrite(error.to_string()))?;
        WRITTEN_FRAMES.fetch_add((samples.len() / usize::from(NUM_CHANNELS)) as u64, Ordering::Relaxed);
        let output = match &mut self.resampler {
            Some(resampler) => {
                resampler.process(samples, &mut self.converted);
                std::mem::take(&mut self.converted)
            }
            None => converter.f64_to_f32(samples),
        };
        if !output.is_empty() {
            self.queued
                .push_back(output.len() / usize::from(NUM_CHANNELS));
            let buffer = rodio::buffer::SamplesBuffer::new(
                cpal::ChannelCount::from(NUM_CHANNELS),
                self.rate,
                output,
            );
            self.sink.append(Faded::new(buffer, Arc::clone(&self.fade)));
        }
        while self.sink.len() > MAX_QUEUED_BUFFERS {
            thread::sleep(Duration::from_millis(10));
        }
        self.report_latency();
        self.last_write = Some(Instant::now());
        Ok(())
    }
}

/// How long the speaker was silent when audio last written `since` ago had
/// `queued` of play time left; `None` while it still played.
fn silence_after(since: Duration, queued: Duration) -> Option<Duration> {
    since.checked_sub(queued).filter(|silence| !silence.is_zero())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_is_what_the_queue_did_not_cover() {
        assert_eq!(silence_after(Duration::from_millis(400), Duration::from_millis(500)), None);
        assert_eq!(
            silence_after(Duration::from_millis(900), Duration::from_millis(500)),
            Some(Duration::from_millis(400))
        );
    }
}
