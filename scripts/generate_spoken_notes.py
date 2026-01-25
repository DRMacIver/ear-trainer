#!/usr/bin/env python3
"""
Generate spoken note names autotuned to their corresponding pitches.

Uses librosa for pitch detection and psola for pitch shifting.
Based on: https://thewolfsound.com/how-to-auto-tune-your-voice-with-python/
"""

import subprocess
import tempfile
from pathlib import Path

import librosa
import numpy as np
import psola
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

C_MAJOR_SCALE = ["C", "D", "E", "F", "G", "A", "B"]


def generate_tts(text: str, output_path: Path) -> None:
    """Generate speech audio using espeak-ng."""
    subprocess.run(
        [
            "espeak-ng",
            "-v", "en-us",
            "-s", "120",
            "-w", str(output_path),
            text,
        ],
        check=True,
        capture_output=True,
    )


def autotune_to_pitch(audio: np.ndarray, sr: int, target_freq: float) -> np.ndarray:
    """
    Autotune audio to a specific target frequency using librosa + psola.
    """
    # Detect pitch using PYIN
    f0, voiced_flag, voiced_probs = librosa.pyin(
        audio,
        fmin=librosa.note_to_hz('C2'),
        fmax=librosa.note_to_hz('C6'),
        sr=sr,
    )

    # Create target pitch array - constant at target frequency where voiced
    target_f0 = np.where(voiced_flag, target_freq, np.nan)

    # Where we couldn't detect pitch, use target anyway
    target_f0 = np.where(np.isnan(f0), target_freq, target_f0)

    # Use psola to shift pitch
    return psola.vocode(audio, sample_rate=sr, target_pitch=target_f0, fmin=50, fmax=800)


def trim_silence(audio: np.ndarray, threshold: float = 0.01) -> np.ndarray:
    """Trim leading and trailing silence."""
    nonzero = np.where(np.abs(audio) > threshold)[0]
    if len(nonzero) == 0:
        return audio
    start = max(0, nonzero[0] - 100)
    end = min(len(audio), nonzero[-1] + 100)
    return audio[start:end]


def generate_spoken_note(note: str, output_path: Path, target_sr: int = 44100) -> None:
    """Generate a spoken note name pitched to its frequency."""
    freq = NOTE_FREQUENCIES[note]
    print(f"Generating {note} at {freq:.2f} Hz...")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        # Generate TTS
        tts_path = tmp / "tts.wav"
        generate_tts(note, tts_path)

        # Load audio
        audio, sr = sf.read(tts_path)
        audio = trim_silence(audio)
        print(f"    Duration: {len(audio)/sr:.2f}s")

        # Autotune to target pitch
        autotuned = autotune_to_pitch(audio, sr, freq)

        # Normalize
        max_val = np.max(np.abs(autotuned))
        if max_val > 0:
            autotuned = autotuned / max_val * 0.8

        # Fade in/out
        fade_samples = int(0.02 * sr)
        if len(autotuned) > 2 * fade_samples:
            autotuned[:fade_samples] *= np.linspace(0, 1, fade_samples)
            autotuned[-fade_samples:] *= np.linspace(1, 0, fade_samples)

        # Resample if needed
        if sr != target_sr:
            autotuned = librosa.resample(autotuned, orig_sr=sr, target_sr=target_sr)

        sf.write(output_path, autotuned.astype(np.float32), target_sr)
    print(f"    Saved to {output_path}")


def main() -> None:
    """Generate spoken notes for the C Major scale."""
    output_dir = Path(__file__).parent.parent / "public" / "audio" / "spoken-notes"
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Output directory: {output_dir}\n")

    # Check for espeak-ng
    try:
        subprocess.run(["espeak-ng", "--version"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("ERROR: espeak-ng not installed")
        return

    print("Generating C Major scale (octave 4) spoken notes...\n")

    for note in C_MAJOR_SCALE:
        output_path = output_dir / f"{note}4.wav"
        generate_spoken_note(note, output_path)
        print()

    print("Done!")


if __name__ == "__main__":
    main()
