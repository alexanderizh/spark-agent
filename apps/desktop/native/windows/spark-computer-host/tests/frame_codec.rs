use spark_computer_host::frame_codec::{
    Frame, FrameDecoder, FrameKind, MAX_FRAME_PAYLOAD_BYTES, encode_frame,
};

#[test]
fn decodes_fragmented_and_adjacent_json_and_binary_frames() {
    let json = encode_frame(FrameKind::Json, br#"{"type":"ping"}"#).unwrap();
    let binary = encode_frame(FrameKind::Binary, &[0, 1, 2, 255]).unwrap();
    let stream = [json.as_slice(), binary.as_slice()].concat();
    let mut decoder = FrameDecoder::new(1024).unwrap();

    assert!(decoder.push(&stream[..3]).unwrap().is_empty());
    let first = decoder.push(&stream[3..json.len() + 2]).unwrap();
    assert_eq!(
        first,
        vec![Frame::new(FrameKind::Json, br#"{"type":"ping"}"#.to_vec())]
    );
    let second = decoder.push(&stream[json.len() + 2..]).unwrap();
    assert_eq!(
        second,
        vec![Frame::new(FrameKind::Binary, vec![0, 1, 2, 255])]
    );
    decoder.finish().unwrap();
}

#[test]
fn rejects_empty_unknown_oversized_and_truncated_frames() {
    assert!(FrameDecoder::new(0).is_err());
    assert!(
        FrameDecoder::new(1024)
            .unwrap()
            .push(&[0, 0, 0, 0, 1])
            .is_err()
    );
    assert!(
        FrameDecoder::new(1024)
            .unwrap()
            .push(&[0, 0, 0, 1, 9, 0])
            .is_err()
    );
    assert!(
        FrameDecoder::new(1024)
            .unwrap()
            .push(&[0, 0, 4, 1, 1])
            .is_err()
    );
    assert!(encode_frame(FrameKind::Json, &[]).is_err());
    assert!(encode_frame(FrameKind::Binary, &vec![0; MAX_FRAME_PAYLOAD_BYTES + 1]).is_err());

    let mut truncated = FrameDecoder::new(1024).unwrap();
    truncated.push(&[0, 0, 0, 3, 1, 123]).unwrap();
    assert!(truncated.finish().is_err());
}
