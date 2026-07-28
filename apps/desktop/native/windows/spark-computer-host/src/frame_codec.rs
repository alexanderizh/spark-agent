use std::collections::VecDeque;
use thiserror::Error;

const HEADER_BYTES: usize = 5;
pub const MAX_FRAME_PAYLOAD_BYTES: usize = 67_108_864;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FrameKind {
    Json,
    Binary,
}

impl FrameKind {
    fn byte(self) -> u8 {
        match self {
            Self::Json => 1,
            Self::Binary => 2,
        }
    }

    fn from_byte(value: u8) -> Result<Self, FrameCodecError> {
        match value {
            1 => Ok(Self::Json),
            2 => Ok(Self::Binary),
            _ => Err(FrameCodecError::UnknownKind),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Frame {
    pub kind: FrameKind,
    pub payload: Vec<u8>,
}

impl Frame {
    pub fn new(kind: FrameKind, payload: Vec<u8>) -> Self {
        Self { kind, payload }
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum FrameCodecError {
    #[error("frame limit must be positive")]
    InvalidLimit,
    #[error("frames cannot be empty")]
    EmptyPayload,
    #[error("frame exceeds configured limit")]
    PayloadTooLarge,
    #[error("frame has an unknown kind")]
    UnknownKind,
    #[error("stream ended inside a frame")]
    Truncated,
}

struct Chunk {
    bytes: Vec<u8>,
    offset: usize,
}

pub struct FrameDecoder {
    chunks: VecDeque<Chunk>,
    buffered_bytes: usize,
    max_payload_bytes: usize,
}

impl FrameDecoder {
    pub fn new(max_payload_bytes: usize) -> Result<Self, FrameCodecError> {
        if max_payload_bytes == 0 {
            return Err(FrameCodecError::InvalidLimit);
        }
        Ok(Self {
            chunks: VecDeque::new(),
            buffered_bytes: 0,
            max_payload_bytes,
        })
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Frame>, FrameCodecError> {
        if !bytes.is_empty() {
            self.buffered_bytes = self
                .buffered_bytes
                .checked_add(bytes.len())
                .ok_or(FrameCodecError::PayloadTooLarge)?;
            self.chunks.push_back(Chunk {
                bytes: bytes.to_vec(),
                offset: 0,
            });
        }

        let mut frames = Vec::new();
        loop {
            if self.buffered_bytes < HEADER_BYTES {
                break;
            }
            let header = self.peek_prefix::<HEADER_BYTES>();
            let payload_len =
                u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as usize;
            if payload_len == 0 {
                return Err(FrameCodecError::EmptyPayload);
            }
            if payload_len > self.max_payload_bytes {
                return Err(FrameCodecError::PayloadTooLarge);
            }
            let kind = FrameKind::from_byte(header[4])?;
            let frame_len = HEADER_BYTES + payload_len;
            if self.buffered_bytes < frame_len {
                break;
            }
            self.discard(HEADER_BYTES);
            frames.push(Frame::new(kind, self.take(payload_len)));
        }
        Ok(frames)
    }

    pub fn finish(self) -> Result<(), FrameCodecError> {
        if self.buffered_bytes == 0 {
            Ok(())
        } else {
            Err(FrameCodecError::Truncated)
        }
    }

    fn peek_prefix<const N: usize>(&self) -> [u8; N] {
        let mut output = [0_u8; N];
        let mut written = 0;
        for chunk in &self.chunks {
            let remaining = &chunk.bytes[chunk.offset..];
            let count = remaining.len().min(N - written);
            output[written..written + count].copy_from_slice(&remaining[..count]);
            written += count;
            if written == N {
                break;
            }
        }
        output
    }

    fn take(&mut self, count: usize) -> Vec<u8> {
        let mut output = Vec::with_capacity(count);
        let mut remaining = count;
        while remaining > 0 {
            let front = self.chunks.front_mut().expect("buffer length invariant");
            let available = front.bytes.len() - front.offset;
            let consumed = available.min(remaining);
            output.extend_from_slice(&front.bytes[front.offset..front.offset + consumed]);
            front.offset += consumed;
            remaining -= consumed;
            self.buffered_bytes -= consumed;
            if front.offset == front.bytes.len() {
                self.chunks.pop_front();
            }
        }
        output
    }

    fn discard(&mut self, count: usize) {
        let _ = self.take(count);
    }
}

pub fn encode_frame(kind: FrameKind, payload: &[u8]) -> Result<Vec<u8>, FrameCodecError> {
    if payload.is_empty() {
        return Err(FrameCodecError::EmptyPayload);
    }
    if payload.len() > MAX_FRAME_PAYLOAD_BYTES || payload.len() > u32::MAX as usize {
        return Err(FrameCodecError::PayloadTooLarge);
    }
    let mut frame = Vec::with_capacity(HEADER_BYTES + payload.len());
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.push(kind.byte());
    frame.extend_from_slice(payload);
    Ok(frame)
}
