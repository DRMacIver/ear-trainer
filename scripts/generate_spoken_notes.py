#!/usr/bin/env python3
"""
Generate spoken note names autotuned to their corresponding pitches.

Each note name (C, D, E, etc.) is spoken and pitch-shifted to match
the actual frequency of that note, creating an audio association
between the name and the pitch.
"""

import subprocess
import tempfile
from pathlib import Path

import numpy as np
import parselmouth
from parselmouth.praat import call
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
            "-s", str(rate),  # Slower speech rate for drawn out effect
            "-w", str(output_path),
            text,
        ],
        check=True,
        capture_output=True,
    )


def autotune_to_pitch(sound: parselmouth.Sound, target_freq: float) -> parselmouth.Sound:
    """
    Autotune audio to a specific frequency using Praat's PSOLA.

    This manipulates the pitch contour to be a constant frequency
    while preserving formants and timing.
    """
    # Create manipulation object
    manipulation = call(sound, "To Manipulation", 0.01, 75, 600)

    # Extract pitch tier
    pitch_tier = call(manipulation, "Extract pitch tier")

    # Remove all existing pitch points
    call(pitch_tier, "Remove points between", 0, sound.duration)

    # Add constant pitch at target frequency
    call(pitch_tier, "Add point", 0.0, target_freq)
    call(pitch_tier, "Add point", sound.duration, target_freq)

    # Replace pitch tier
    call([manipulation, pitch_tier], "Replace pitch tier")

    # Resynthesize using PSOLA
    result = call(manipulation, "Get resynthesis (overlap-add)")

    return result


def time_stretch_praat(sound: parselmouth.Sound, target_duration: float) -> parselmouth.Sound:
    """Time-stretch audio to a target duration using Praat."""
    current_duration = sound.duration
    ratio = target_duration / current_duration

    if abs(ratio - 1.0) < 0.01:
        return sound

    # Use Praat's duration tier manipulation
    manipulation = call(sound, "To Manipulation", 0.01, 75, 600)

    # Create duration tier
    duration_tier = call(manipulation, "Extract duration tier")

    # Remove existing points and add constant stretch
    call(duration_tier, "Remove points between", 0, current_duration)
    call(duration_tier, "Add point", 0.0, ratio)
    call(duration_tier, "Add point", current_duration, ratio)

    # Replace duration tier
    call([manipulation, duration_tier], "Replace duration tier")

    # Resynthesize
    result = call(manipulation, "Get resynthesis (overlap-add)")

    return result


def generate_spoken_note(
    note: str,
    output_path: Path,
    duration: float = 3.0,
) -> None:
    """Generate a spoken note name autotuned to its pitch."""
    freq = NOTE_FREQUENCIES[note]
    print(f"Generating {note} at {freq:.2f} Hz...")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        # Step 1: Generate TTS
        tts_path = tmp / "tts.wav"
        generate_tts(note, tts_path)

        # Load with Praat
        sound = parselmouth.Sound(str(tts_path))

        # Step 2: Time stretch first (before pitch modification)
        stretched = time_stretch_praat(sound, duration)

        # Step 3: Autotune to target pitch
        autotuned = autotune_to_pitch(stretched, freq)

        # Convert to numpy for post-processing
        audio = autotuned.values[0]
        sr = int(autotuned.sampling_frequency)

        # Normalize
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio / max_val * 0.9

        # Apply fade in/out to avoid clicks
        fade_samples = int(0.05 * sr)  # 50ms fade
        if len(audio) > 2 * fade_samples:
            fade_in = np.linspace(0, 1, fade_samples)
            fade_out = np.linspace(1, 0, fade_samples)
            audio[:fade_samples] *= fade_in
            audio[-fade_samples:] *= fade_out

        # Save
        sf.write(output_path, audio.astype(np.float32), sr)

    print(f"  Saved to {output_path}")


def main() -> None:
    """Generate spoken notes for the C Major scale."""
    # Output directory
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
    print("Done! Generated files:")
    for note in C_MAJOR_SCALE:
        print(f"  {output_dir / f'{note}4.wav'}")


if __name__ == "__main__":
    main()
