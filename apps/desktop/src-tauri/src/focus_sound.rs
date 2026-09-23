//! Owner-only native focus sounds.
//!
//! The Rust owner plays a sound only after durably claiming the engine's
//! sound token (`FocusService::claim_sound`), so two windows can never both
//! play it and a webview never plays focus sounds on its own. The tones are
//! Nimble's own: the completion sound is the same C5→E5 two-tone chime the
//! app has always used (`src/lib/sound.ts`), synthesized here as a small
//! in-memory WAV; the timebox chime is a softer E5→A5 bell. No asset file,
//! and no copied Todoist sound. Any audio failure is swallowed: sound never
//! affects accounting.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FocusSound {
    /// A focus occurrence was completed.
    Complete,
    /// A timebox reached zero (overtime continues).
    Chime,
}

impl FocusSound {
    /// Engine tokens are `complete:<uuid>` / `chime:<uuid>`.
    pub fn from_token(token: &str) -> Option<Self> {
        match token.split_once(':').map(|(kind, _)| kind) {
            Some("complete") => Some(Self::Complete),
            Some("chime") => Some(Self::Chime),
            _ => None,
        }
    }

    /// (frequency Hz, start ms, end ms) — mirrors sound.ts timing.
    fn tones(self) -> &'static [(f32, u32, u32)] {
        match self {
            Self::Complete => &[(523.0, 0, 150), (659.0, 80, 250)],
            Self::Chime => &[(659.0, 0, 220), (880.0, 120, 420)],
        }
    }
}

const RATE: u32 = 44_100;

/// 16-bit mono PCM WAV of decaying sine tones.
pub fn wav(sound: FocusSound) -> Vec<u8> {
    let tones = sound.tones();
    let total_ms = tones.iter().map(|t| t.2).max().unwrap_or(0);
    let frames = (RATE as u64 * total_ms as u64 / 1_000) as usize;
    let mut samples = vec![0f32; frames];
    for &(freq, start, end) in tones {
        let a = (RATE as u64 * start as u64 / 1_000) as usize;
        let b = ((RATE as u64 * end as u64 / 1_000) as usize).min(frames);
        let len = (b - a).max(1) as f32;
        for (i, sample) in samples[a..b].iter_mut().enumerate() {
            let t = i as f32 / RATE as f32;
            // 0.3 → 0.01 exponential decay, like the webview gain ramp.
            let gain = 0.3 * (0.01f32 / 0.3).powf(i as f32 / len);
            *sample += gain * (2.0 * std::f32::consts::PI * freq * t).sin();
        }
    }
    let data_len = (frames * 2) as u32;
    let mut out = Vec::with_capacity(44 + frames * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// Fire-and-forget native playback on the main thread.
pub fn play(app: &tauri::AppHandle, sound: FocusSound) {
    let bytes = wav(sound);
    let _ = app.run_on_main_thread(move || play_on_main(bytes));
}

#[cfg(target_os = "macos")]
fn play_on_main(bytes: Vec<u8>) {
    use objc2::AllocAnyThread;
    use objc2_app_kit::NSSound;
    use objc2_foundation::NSData;
    thread_local! {
        // NSSound stops when released; keep the latest one alive.
        static CURRENT: std::cell::RefCell<Option<objc2::rc::Retained<NSSound>>> =
            const { std::cell::RefCell::new(None) };
    }
    let data = NSData::from_vec(bytes);
    if let Some(sound) = NSSound::initWithData(NSSound::alloc(), &data) {
        if !sound.play() {
            log::warn!("Focus sound could not play");
        }
        CURRENT.with(|c| *c.borrow_mut() = Some(sound));
    }
}

#[cfg(not(target_os = "macos"))]
fn play_on_main(_bytes: Vec<u8>) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_map_to_their_sound_and_unknown_tokens_are_silent() {
        assert_eq!(
            FocusSound::from_token("complete:1"),
            Some(FocusSound::Complete)
        );
        assert_eq!(FocusSound::from_token("chime:1"), Some(FocusSound::Chime));
        assert_eq!(FocusSound::from_token("legacy-uuid"), None);
    }

    #[test]
    fn wav_is_a_well_formed_mono_pcm_clip() {
        for sound in [FocusSound::Complete, FocusSound::Chime] {
            let w = wav(sound);
            assert_eq!(&w[0..4], b"RIFF");
            assert_eq!(&w[8..16], b"WAVEfmt ");
            let riff = u32::from_le_bytes(w[4..8].try_into().unwrap()) as usize;
            assert_eq!(riff + 8, w.len());
            let data = u32::from_le_bytes(w[40..44].try_into().unwrap()) as usize;
            assert_eq!(data + 44, w.len());
            assert!(w.len() > 44 + 2 * 44_100 / 10, "at least 100 ms of audio");
        }
    }
}
