#!/usr/bin/env python3
"""
Generate spoken note names autotuned to their corresponding pitches.

Uses rubberband for high-quality formant-preserving pitch shifting.
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

# Average pitch of espeak voice (roughly)
ESPEAK_BASE_PITCH = 170.0  # Hz, approximate fundamental of espeak en-us voice

# C Major scale notes in order
C_MAJOR_SCALE = ["C", "D", "E", "F", "G", "A", "B"]


def generate_tts(text: str, output_path: Path, rate: int = 40) -> None:
    """Generate speech audio using espeak-ng with extended vowel."""
    # Use phoneme input to extend the vowel sound
    # Most note names end in "ee" sound
    subprocess.run(
        [
            "espeak-ng",
            "-v", "en-us",
            "-s", str(rate),  # Very slow for longer sound
            "-p", "50",  # Default pitch
            "-w", str(output_path),
            text,
        ],
        check=True,
        capture_output=True,
    )


def pitch_shift_rubberband(
    input_path: Path,
    output_path: Path,
    semitones: float,
) -> None:
    """Use rubberband for formant-preserving pitch shift."""
    subprocess.run(
        [
            "rubberband",
            "-p", str(semitones),  # Pitch shift in semitones
            "-F",  # Formant preserving mode
            "-3",  # High quality
            str(input_path),
            str(output_path),
        ],
        check=True,
        capture_output=True,
    )


def time_stretch_rubberband(
    input_path: Path,
    output_path: Path,
    ratio: float,
) -> None:
    """Use rubberband for time stretching."""
    subprocess.run(
        [
            "rubberband",
            "-t", str(ratio),  # Time stretch ratio
            "-3",  # High quality
            str(input_path),
            str(output_path),
        ],
        check=True,
        capture_output=True,
    )


def freq_to_semitones(from_freq: float, to_freq: float) -> float:
    """Calculate semitone difference between two frequencies."""
    return 12 * np.log2(to_freq / from_freq)


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

        # Step 1: Generate TTS (slow rate for longer vowel)
        tts_path = tmp / "tts.wav"
        generate_tts(note, tts_path)

        # Load to check duration and get sample rate
        audio, sr = sf.read(tts_path)
        current_duration = len(audio) / sr

        # Step 2: Time stretch to target duration
        stretch_ratio = duration / current_duration
        stretched_path = tmp / "stretched.wav"
        time_stretch_rubberband(tts_path, stretched_path, stretch_ratio)

        # Step 3: Pitch shift to target frequency
        # Calculate semitones from espeak's base pitch to target
        semitones = freq_to_semitones(ESPEAK_BASE_PITCH, freq)
        shifted_path = tmp / "shifted.wav"
        pitch_shift_rubberband(stretched_path, shifted_path, semitones)

        # Load result
        audio, sr = sf.read(shifted_path)

        # Convert to mono if stereo
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        # Normalize
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio / max_val * 0.8

        # Apply fade in/out
        fade_samples = int(0.05 * sr)
        if len(audio) > 2 * fade_samples:
            audio[:fade_samples] *= np.linspace(0, 1, fade_samples)
            audio[-fade_samples:] *= np.linspace(1, 0, fade_samples)

        # Resample if needed
        if sr != target_sr:
            n_samples_new = int(len(audio) * target_sr / sr)
            audio = np.interp(
                np.linspace(0, len(audio) - 1, n_samples_new),
                np.arange(len(audio)),
                audio
            )
            sr = target_sr

        # Save
        sf.write(output_path, audio.astype(np.float32), sr)

    print(f"  Saved to {output_path}")


def main() -> None:
    """Generate spoken notes for the C Major scale."""
    output_dir = Path(__file__).parent.parent / "public" / "audio" / "spoken-notes"
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Output directory: {output_dir}")
    print()

    # Check dependencies
    try:
        subprocess.run(["espeak-ng", "--version"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("ERROR: espeak-ng not installed. Run: sudo apt install espeak-ng")
        return

    try:
        subprocess.run(["rubberband", "--version"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("ERROR: rubberband not installed. Run: sudo apt install rubberband-cli")
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
