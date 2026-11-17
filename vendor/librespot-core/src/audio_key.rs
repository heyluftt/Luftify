use std::{collections::HashMap, io::Write, time::Duration};

use byteorder::{BigEndian, ByteOrder, WriteBytesExt};
use bytes::Bytes;
use thiserror::Error;
use tokio::sync::oneshot;

use crate::{Error, FileId, SpotifyId, packet::PacketType, util::SeqGenerator};

#[derive(Debug, Hash, PartialEq, Eq, Copy, Clone)]
pub struct AudioKey(pub [u8; 16]);

#[derive(Debug, Error)]
pub enum AudioKeyError {
    #[error("audio key error")]
    AesKey,
    // Luftify: Spotify's key allowance is used up ("error audio key 0 2");
    // a key is there again shortly, unlike a key refused for one file.
    #[error("audio key allowance used up")]
    Limit,
    #[error("other end of channel disconnected")]
    Channel,
    #[error("unexpected packet type {0}")]
    Packet(u8),
    #[error("sequence {0} not pending")]
    Sequence(u32),
    #[error("audio key response timeout")]
    Timeout,
}

impl From<AudioKeyError> for Error {
    fn from(err: AudioKeyError) -> Self {
        match err {
            AudioKeyError::AesKey => Error::unavailable(err),
            AudioKeyError::Limit => Error::resource_exhausted(err),
            AudioKeyError::Channel => Error::aborted(err),
            AudioKeyError::Sequence(_) => Error::aborted(err),
            AudioKeyError::Packet(_) => Error::unimplemented(err),
            AudioKeyError::Timeout => Error::aborted(err),
        }
    }
}

component! {
    AudioKeyManager : AudioKeyManagerInner {
        sequence: SeqGenerator<u32> = SeqGenerator::new(0),
        pending: HashMap<u32, oneshot::Sender<Result<AudioKey, Error>>> = HashMap::new(),
    }
}

impl AudioKeyManager {
    pub(crate) fn dispatch(&self, cmd: PacketType, mut data: Bytes) -> Result<(), Error> {
        let seq = BigEndian::read_u32(data.split_to(4).as_ref());

        let sender = self
            .lock(|inner| inner.pending.remove(&seq))
            .ok_or(AudioKeyError::Sequence(seq))?;

        match cmd {
            PacketType::AesKey => {
                let mut key = [0u8; 16];
                key.copy_from_slice(data.as_ref());
                sender
                    .send(Ok(AudioKey(key)))
                    .map_err(|_| AudioKeyError::Channel)?
            }
            PacketType::AesKeyError => {
                error!(
                    "error audio key {:x} {:x}",
                    data.as_ref()[0],
                    data.as_ref()[1]
                );
                // Luftify: tell the used-up allowance apart from a refused file.
                let refusal = if data.as_ref()[..2] == [0, 2] {
                    AudioKeyError::Limit
                } else {
                    AudioKeyError::AesKey
                };
                sender
                    .send(Err(refusal.into()))
                    .map_err(|_| AudioKeyError::Channel)?
            }
            _ => {
                trace!("Did not expect {cmd:?} AES key packet with data {data:#?}");
                return Err(AudioKeyError::Packet(cmd as u8).into());
            }
        }

        Ok(())
    }

    pub async fn request(&self, track: SpotifyId, file: FileId) -> Result<AudioKey, Error> {
        let (tx, rx) = oneshot::channel();

        let seq = self.lock(move |inner| {
            let seq = inner.sequence.get();
            inner.pending.insert(seq, tx);
            seq
        });

        self.send_key_request(seq, track, file)?;
        const KEY_RESPONSE_TIMEOUT: Duration = Duration::from_millis(1500);
        match tokio::time::timeout(KEY_RESPONSE_TIMEOUT, rx).await {
            Err(_) => {
                error!("Audio key response timeout");
                Err(AudioKeyError::Timeout.into())
            }
            Ok(k) => k?,
        }
    }

    fn send_key_request(&self, seq: u32, track: SpotifyId, file: FileId) -> Result<(), Error> {
        let mut data: Vec<u8> = Vec::new();
        data.write_all(&file.0)?;
        data.write_all(&track.to_raw())?;
        data.write_u32::<BigEndian>(seq)?;
        data.write_u16::<BigEndian>(0x0000)?;

        self.session().send_packet(PacketType::RequestKey, data)
    }
}
