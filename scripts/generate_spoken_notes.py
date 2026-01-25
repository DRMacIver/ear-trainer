#!/usr/bin/env python3
"""
Generate spoken note names autotuned to their corresponding pitches.

Uses a vocoder-style approach: extracts the spectral envelope from speech
and applies it to a carrier wave at the target frequency.
"""

import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf


# Note frequencies for octave 4 (A4 = 440 Hz, equal temperament)
NOTE_FREQUENCIES = {
    "C": 261.63,
    "D": 293.66,
    "E": 329.63,
    "F": 349.23,
    "G": 392.00,
    "A": 440.00,
    "B": 493.88,
}

# C Major scale notes in order
C_MAJOR_SCALE = ["C", "D", "E", "F", "G", "A", "B"]


def generate_tts(text: str, output_path: Path, rate: int = 80) -> None:
    """Generate speech audio using espeak-ng."""
    subprocess.run(
        [
            "espeak-ng",
            "-v", "en-us",
            "-s", str(rate),
            "-w", str(output_path),
            text,
        ],
        check=True,
        capture_output=True,
    )


def vocoder_resynth(
    speech: np.ndarray,
    sr: int,
    target_freq: float,
    target_duration: float,
) -> np.ndarray:
    """
    Vocoder-style resynthesis: extract envelope from speech,
    apply to a carrier wave at target frequency.
    """
    # Generate carrier wave at target frequency for full duration
    n_samples = int(target_duration * sr)
    t = np.arange(n_samples) / sr

    # Use a richer carrier - fundamental + harmonics for more voice-like timbre
    carrier = np.zeros(n_samples)
    for harmonic in range(1, 8):
        amp = 1.0 / harmonic  # Decreasing amplitude for higher harmonics
        carrier += amp * np.sin(2 * np.pi * target_freq * harmonic * t)
    carrier = carrier / np.max(np.abs(carrier))

    # Extract amplitude envelope from speech using Hilbert transform approximation
    # (simple moving RMS for robustness)
    window_size = int(0.02 * sr)  # 20ms window
    speech_padded = np.pad(speech, (window_size // 2, window_size // 2), mode='edge')
    envelope = np.array([
        np.sqrt(np.mean(speech_padded[i:i + window_size] ** 2))
        for i in range(len(speech))
    ])

    # Smooth the envelope
    smooth_window = int(0.01 * sr)
    if smooth_window > 1:
        kernel = np.ones(smooth_window) / smooth_window
        envelope = np.convolve(envelope, kernel, mode='same')

    # Stretch envelope to target duration
    envelope_stretched = np.interp(
        np.linspace(0, len(envelope) - 1, n_samples),
        np.arange(len(envelope)),
        envelope
    )

    # Apply envelope to carrier
    output = carrier * envelope_stretched

    # Add subtle attack from original consonant
    # Blend in the first ~50ms of original speech for consonant clarity
    consonant_samples = min(int(0.08 * sr), len(speech))
    blend_region = int(0.15 * sr)  # Crossfade region

    if consonant_samples > 0 and blend_region < n_samples:
        # Pitch-shift the consonant region to target frequency
        # For simplicity, just use the original (consonants are mostly noise anyway)
        consonant = speech[:consonant_samples]

        # Pad consonant to blend_region if needed
        if len(consonant) < blend_region:
            consonant = np.pad(consonant, (0, blend_region - len(consonant)))
        else:
            consonant = consonant[:blend_region]

        # Create crossfade
        fade_out = np.linspace(1, 0, blend_region)
        fade_in = np.linspace(0, 1, blend_region)

        # Normalize consonant to similar level
        consonant_norm = consonant * (np.max(envelope_stretched[:blend_region]) /
                                       (np.max(np.abs(consonant)) + 1e-10))

        output[:blend_region] = (consonant_norm * fade_out +
                                  output[:blend_region] * fade_in)

    return output


def generate_spoken_note(
    note: str,
    output_path: Path,
    duration: float = 3.0,
    target_sr: int = 44100,
) -> None:
    """Generate a spoken note name autotuned to its pitch."""
    freq = NOTE_FREQUENCIES[note]
    print(f"Generating {note} at {freq:.2f} Hz...")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        # Step 1: Generate TTS
        tts_path = tmp / "tts.wav"
        generate_tts(note, tts_path)

        # Load the audio
        audio, sr = sf.read(tts_path)

        # Convert to mono if stereo
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        # Resample to target SR if needed
        if sr != target_sr:
            # Simple resampling via interpolation
            duration_orig = len(audio) / sr
            n_samples_new = int(duration_orig * target_sr)
            audio = np.interp(
                np.linspace(0, len(audio) - 1, n_samples_new),
                np.arange(len(audio)),
                audio
            )
            sr = target_sr

        # Step 2: Vocoder resynthesis
        output = vocoder_resynth(audio, sr, freq, duration)

        # Normalize
        max_val = np.max(np.abs(output))
        if max_val > 0:
            output = output / max_val * 0.8

        # Apply fade in/out
        fade_samples = int(0.05 * sr)
        if len(output) > 2 * fade_samples:
            output[:fade_samples] *= np.linspace(0, 1, fade_samples)
            output[-fade_samples:] *= np.linspace(1, 0, fade_samples)

        # Save
        sf.write(output_path, output.astype(np.float32), sr)

    print(f"  Saved to {output_path}")


def main() -> None:
    """Generate spoken notes for the C Major scale."""
    output_dir = Path(__file__).parent.parent / "public" / "audio" / "spoken-notes"
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Output directory: {output_dir}")
    print()

    # Check for espeak-ng
    try:
        subprocess.run(["espeak-ng", "--version"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("ERROR: espeak-ng not installed. Run: sudo apt install espeak-ng")
        return

    print("Generating C Major scale (octave 4) spoken notes...")
    print()

    for note in C_MAJOR_SCALE:
        output_path = output_dir / f"{note}4.wav"
        generate_spoken_note(note, output_path, duration=3.0)

    print()
    print("Done!")


if __name__ == "__main__":
    main()
