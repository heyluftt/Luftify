//! The `AUDIO_FILES` metadata extension, which the Spotify desktop client asks
//! for a song's audio files (with their average bitrate and loudness).
//! librespot reads the files only from the song record (`TRACK_V4`) and does
//! not compile this message, so it is read here by hand:
//!
//! ```proto
//! message AudioFilesExtensionResponse {
//!     repeated ExtendedAudioFile files = 1;            // { metadata.AudioFile file = 1; int32 average_bitrate = 4; }
//!     NormalizationParams default_file_normalization_params = 2;  // { float loudness_db = 1; float true_peak_db = 2; }
//!     NormalizationParams default_album_normalization_params = 3;
//!     bytes audio_id = 4;
//! }
//! ```
use librespot::{
    core::FileId,
    metadata::audio::AudioFileFormat,
    protocol::metadata::AudioFile as AudioFileMessage,
};
use protobuf::{CodedInputStream, Message, rt::WireType};

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ExtendedFile {
    pub format: AudioFileFormat,
    pub file: FileId,
    pub average_bitrate: Option<i32>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct AudioFiles {
    pub files: Vec<ExtendedFile>,
    /// Track loudness and true peak in dB, for evening out volume without ReplayGain.
    pub loudness: Option<(f32, f32)>,
}

pub(crate) fn parse(bytes: &[u8]) -> Option<AudioFiles> {
    let mut input = CodedInputStream::from_bytes(bytes);
    let mut parsed = AudioFiles::default();
    while let Some(tag) = input.read_raw_tag_or_eof().ok()? {
        let (field, wire) = (tag >> 3, WireType::new(tag & 7)?);
        match (field, wire) {
            (1, WireType::LengthDelimited) => {
                if let Some(file) = extended_file(&input.read_bytes().ok()?) {
                    parsed.files.push(file);
                }
            }
            (2, WireType::LengthDelimited) => parsed.loudness = normalization(&input.read_bytes().ok()?),
            _ => input.skip_field(wire).ok()?,
        }
    }
    Some(parsed)
}

fn extended_file(bytes: &[u8]) -> Option<ExtendedFile> {
    let mut input = CodedInputStream::from_bytes(bytes);
    let (mut message, mut average_bitrate) = (None, None);
    while let Some(tag) = input.read_raw_tag_or_eof().ok()? {
        let (field, wire) = (tag >> 3, WireType::new(tag & 7)?);
        match (field, wire) {
            (1, WireType::LengthDelimited) => message = AudioFileMessage::parse_from_bytes(&input.read_bytes().ok()?).ok(),
            (4, WireType::Varint) => average_bitrate = input.read_int32().ok(),
            _ => input.skip_field(wire).ok()?,
        }
    }
    let message = message?;
    let format = AudioFileFormat::from(message.format?.enum_value().ok()?);
    Some(ExtendedFile { format, file: FileId::from(message.file_id()), average_bitrate })
}

fn normalization(bytes: &[u8]) -> Option<(f32, f32)> {
    let mut input = CodedInputStream::from_bytes(bytes);
    let (mut loudness, mut peak) = (None, None);
    while let Some(tag) = input.read_raw_tag_or_eof().ok()? {
        let (field, wire) = (tag >> 3, WireType::new(tag & 7)?);
        match (field, wire) {
            (1, WireType::Fixed32) => loudness = input.read_float().ok(),
            (2, WireType::Fixed32) => peak = input.read_float().ok(),
            _ => input.skip_field(wire).ok()?,
        }
    }
    Some((loudness?, peak.unwrap_or(0.0)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto_wire::{write_len_field, write_varint_field};

    #[test]
    fn reads_files_bitrate_and_loudness() {
        let mut audio_file = Vec::new();
        write_len_field(&mut audio_file, 1, &[0xab; 20]);
        write_varint_field(&mut audio_file, 2, 22); // FLAC_FLAC_24BIT
        let mut extended = Vec::new();
        write_len_field(&mut extended, 1, &audio_file);
        write_varint_field(&mut extended, 4, 1_411_000);
        let mut normalization = Vec::new();
        normalization.push(0x0d); // field 1, fixed32
        normalization.extend_from_slice(&(-7.5f32).to_le_bytes());
        let mut response = Vec::new();
        write_len_field(&mut response, 1, &extended);
        write_len_field(&mut response, 2, &normalization);
        write_len_field(&mut response, 4, b"audio-id");

        let parsed = parse(&response).expect("parsed");
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].format, AudioFileFormat::FLAC_FLAC_24BIT);
        assert_eq!(parsed.files[0].average_bitrate, Some(1_411_000));
        assert_eq!(parsed.loudness, Some((-7.5, 0.0)));
    }

    #[test]
    fn an_empty_answer_has_no_files() {
        assert_eq!(parse(&[]), Some(AudioFiles::default()));
    }
}
