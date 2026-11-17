//! Hand-written protobuf encoding for the few requests whose messages
//! librespot does not generate.

pub(crate) fn write_len_field(out: &mut Vec<u8>, field: u32, value: &[u8]) {
    encode_varint(out, u64::from(field) << 3 | 2);
    encode_varint(out, value.len() as u64);
    out.extend_from_slice(value);
}

pub(crate) fn write_varint_field(out: &mut Vec<u8>, field: u32, value: u64) {
    encode_varint(out, u64::from(field) << 3);
    encode_varint(out, value);
}

pub(crate) fn encode_varint(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        out.push((value as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}
