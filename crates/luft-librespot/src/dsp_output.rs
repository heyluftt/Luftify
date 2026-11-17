use librespot::playback::{
    SAMPLE_RATE,
    audio_backend::{Sink, SinkResult},
    convert::Converter,
    decoder::AudioPacket,
};
use luft_audio::{DspControl, DspProcessor, VisualizerAnalyzer, VisualizerControl};
use tracing::info;

pub(crate) struct DspSink {
    output: Box<dyn Sink>,
    processor: DspProcessor,
    visualizer: VisualizerAnalyzer,
    control: DspControl,
    audio_path_reported: bool,
}

impl DspSink {
    pub(crate) fn boxed(
        output: Box<dyn Sink>,
        control: DspControl,
        visualizer: VisualizerControl,
    ) -> Box<dyn Sink> {
        Box::new(Self {
            output,
            processor: DspProcessor::new(SAMPLE_RATE, control.clone()),
            visualizer: VisualizerAnalyzer::new(SAMPLE_RATE, visualizer),
            control,
            audio_path_reported: false,
        })
    }
}

impl Sink for DspSink {
    fn start(&mut self) -> SinkResult<()> {
        self.output.start()
    }

    fn stop(&mut self) -> SinkResult<()> {
        self.visualizer.reset();
        // The next song, maybe much later, must not start in this one's hall.
        self.processor.clear_tail();
        self.output.stop()
    }

    fn cut(&mut self) -> SinkResult<()> {
        self.visualizer.reset();
        // What is queued is processed already; only what follows starts clean.
        self.processor.clear_tail();
        self.output.cut()
    }

    fn pause_softly(&mut self) -> SinkResult<()> {
        // The hall stays: the resume continues exactly where the queue ends.
        self.visualizer.reset();
        self.output.pause_softly()
    }

    fn write(&mut self, packet: AudioPacket, converter: &mut Converter) -> SinkResult<()> {
        match packet {
            AudioPacket::Samples(mut samples) => {
                if !self.audio_path_reported {
                    let settings = self.control.settings();
                    info!(
                        adapter = "librespot",
                        equalizer_enabled = settings.enabled,
                        equalizer_preset = %settings.preset_id,
                        volume_boost_enabled = settings.volume_boost_enabled,
                        volume_boost_db = settings.volume_boost_db,
                        space_enabled = settings.spatial.enabled,
                        space_preset = %settings.spatial.preset_id,
                        sample_rate = SAMPLE_RATE,
                        packet_samples = samples.len(),
                        "libre dsp is receiving decoded audio"
                    );
                    self.audio_path_reported = true;
                }
                self.processor.process_interleaved_stereo(&mut samples);
                self.visualizer.process_interleaved_stereo(&samples);
                self.output.write(AudioPacket::Samples(samples), converter)
            }
            packet @ AudioPacket::Raw(_) => self.output.write(packet, converter),
        }
    }
}
