use std::fs::File;
use std::io::{Seek, SeekFrom, Write};

#[cfg(any(target_os = "windows", test))]
pub const SAMPLE_RATE: u32 = 48_000;
#[cfg(any(target_os = "windows", test))]
pub const CHANNELS: u16 = 2;
pub const BYTES_PER_SAMPLE: u16 = 4;

#[cfg(any(target_os = "windows", test))]
pub fn write_float_stereo_wav_header(file: &mut File, data_bytes: u32) -> std::io::Result<()> {
    write_float_wav_header(file, SAMPLE_RATE, CHANNELS, data_bytes)
}

pub fn write_float_wav_header(
    file: &mut File,
    sample_rate: u32,
    channels: u16,
    data_bytes: u32,
) -> std::io::Result<()> {
    let block_align = channels * BYTES_PER_SAMPLE;
    let byte_rate = sample_rate * u32::from(block_align);
    file.seek(SeekFrom::Start(0))?;
    file.write_all(b"RIFF")?;
    file.write_all(&(36u32 + data_bytes).to_le_bytes())?;
    file.write_all(b"WAVEfmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&3u16.to_le_bytes())?; // IEEE float PCM
    file.write_all(&channels.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    file.write_all(&byte_rate.to_le_bytes())?;
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&(BYTES_PER_SAMPLE * 8).to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_bytes.to_le_bytes())?;
    file.seek(SeekFrom::End(0))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::OpenOptions;
    use std::io::{Read, Seek};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn header_describes_float_stereo_capture_and_payload_length() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("voice-memory-wav-{stamp}.tmp"));
        let mut file = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        file.write_all(&[1, 2, 3, 4]).unwrap();
        write_float_stereo_wav_header(&mut file, 4).unwrap();
        file.seek(SeekFrom::Start(0)).unwrap();
        let mut header = [0u8; 44];
        file.read_exact(&mut header).unwrap();
        assert_eq!(&header[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(header[4..8].try_into().unwrap()), 40);
        assert_eq!(&header[8..16], b"WAVEfmt ");
        assert_eq!(u16::from_le_bytes(header[20..22].try_into().unwrap()), 3);
        assert_eq!(
            u16::from_le_bytes(header[22..24].try_into().unwrap()),
            CHANNELS
        );
        assert_eq!(
            u32::from_le_bytes(header[24..28].try_into().unwrap()),
            SAMPLE_RATE
        );
        assert_eq!(&header[36..40], b"data");
        assert_eq!(u32::from_le_bytes(header[40..44].try_into().unwrap()), 4);
        drop(file);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn generic_header_preserves_input_sample_rate_and_channel_count() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("voice-memory-wav-mono-{stamp}.tmp"));
        let mut file = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        write_float_wav_header(&mut file, 44_100, 1, 8).unwrap();
        file.seek(SeekFrom::Start(0)).unwrap();
        let mut header = [0u8; 44];
        file.read_exact(&mut header).unwrap();
        assert_eq!(u16::from_le_bytes(header[22..24].try_into().unwrap()), 1);
        assert_eq!(
            u32::from_le_bytes(header[24..28].try_into().unwrap()),
            44_100
        );
        assert_eq!(
            u32::from_le_bytes(header[28..32].try_into().unwrap()),
            176_400
        );
        assert_eq!(u16::from_le_bytes(header[32..34].try_into().unwrap()), 4);
        assert_eq!(u32::from_le_bytes(header[40..44].try_into().unwrap()), 8);
        drop(file);
        std::fs::remove_file(path).unwrap();
    }
}
