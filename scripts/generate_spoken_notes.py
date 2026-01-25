#!/usr/bin/env python3
"""
Generate sung note names using formant synthesis.

Creates vowel sounds at the target pitch with consonant onsets.
"""

import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal


# Note frequencies for octave 4
NOTE_FREQUENCIES = {
    "C": 261.63,
    "D": 293.66,
    "E": 329.63,
    "F": 349.23,
    "G": 392.00,
    "A": 440.00,
    "B": 493.88,
}

# Vowel formants (F1, F2, F3) in Hz - warmer/lower values for singing
# Reduced F2/F3 for less shrill sound
VOWEL_FORMANTS = {
    "ee": (300, 1800, 2500),   # as in "see", "bee" - warmer
    "ay": (600, 1500, 2200),   # as in "A" - warmer
    "eh": (500, 1600, 2300),   # as in "F" (ef) - warmer
}

# Which vowel each note uses
NOTE_VOWELS = {
    "C": "ee",  # "see"
    "D": "ee",  # "dee"
    "E": "ee",  # "ee"
    "F": "eh",  # "ef"
    "G": "ee",  # "jee"
    "A": "ay",  # "ay"
    "B": "ee",  # "bee"
}

C_MAJOR_SCALE = ["C", "D", "E", "F", "G", "A", "B"]


def generate_glottal_source(f0: float, duration: float, sr: int) -> np.ndarray:
    """
    Generate a glottal pulse train - the sound source for voiced speech.
    Uses a simple model with harmonics that roll off naturally.
    """
    t = np.arange(int(duration * sr)) / sr

    # Generate harmonics with natural roll-off (approx -12dB/octave)
    source = np.zeros_like(t)
    for n in range(1, 40):  # Up to 40 harmonics
        amplitude = 1.0 / (n ** 1.2)  # Roll-off
        source += amplitude * np.sin(2 * np.pi * f0 * n * t)

    return source / np.max(np.abs(source))


def apply_formant_filter(
    source: np.ndarray,
    sr: int,
    formants: tuple[float, float, float],
    bandwidths: tuple[float, float, float] = (80, 120, 150),
) -> np.ndarray:
    """
    Apply formant filtering using resonant bandpass filters.
    """
    output = np.zeros_like(source)

    for freq, bw in zip(formants, bandwidths):
        if freq >= sr / 2:
            continue  # Skip if above Nyquist

        # Design a bandpass filter for this formant
        Q = freq / bw
        b, a = signal.iirpeak(freq, Q, sr)

        # Apply filter
        filtered = signal.lfilter(b, a, source)
        output += filtered

    # Normalize
    if np.max(np.abs(output)) > 0:
        output = output / np.max(np.abs(output))

    return output


def generate_vowel(
    f0: float,
    vowel: str,
    duration: float,
    sr: int,
) -> np.ndarray:
    """Generate a synthetic vowel at the given fundamental frequency."""
    # Generate glottal source
    source = generate_glottal_source(f0, duration, sr)

    # Apply formant filtering
    formants = VOWEL_FORMANTS[vowel]
    vowel_audio = apply_formant_filter(source, sr, formants)

    # Apply amplitude envelope (attack, sustain, release)
    n_samples = len(vowel_audio)
    attack = int(0.05 * sr)   # 50ms attack
    release = int(0.1 * sr)   # 100ms release

    envelope = np.ones(n_samples)
    envelope[:attack] = np.linspace(0, 1, attack)
    envelope[-release:] = np.linspace(1, 0, release)

    return vowel_audio * envelope


def get_consonant_from_tts(note: str, sr: int) -> np.ndarray | None:
    """Extract just the consonant onset from TTS."""
    # Notes that start with consonants
    consonant_notes = {"C", "D", "G", "B"}  # s, d, j, b sounds

    if note not in consonant_notes:
        return None

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tts_path = f.name

    try:
        subprocess.run(
            ["espeak-ng", "-v", "en-us", "-s", "150", "-w", tts_path, note],
            check=True,
            capture_output=True,
        )

        audio, tts_sr = sf.read(tts_path)

        # Resample if needed
        if tts_sr != sr:
            n_samples = int(len(audio) * sr / tts_sr)
            audio = np.interp(
                np.linspace(0, len(audio) - 1, n_samples),
                np.arange(len(audio)),
                audio
            )

        # Extract just the first ~80ms (consonant portion)
        consonant_duration = int(0.08 * sr)
        consonant = audio[:consonant_duration]

        # Apply fade out
        fade_len = int(0.03 * sr)
        consonant[-fade_len:] *= np.linspace(1, 0, fade_len)

        return consonant

    except Exception:
        return None
    finally:
        Path(tts_path).unlink(missing_ok=True)


def generate_sung_note(
    note: str,
    output_path: Path,
    duration: float = 1.5,
    sr: int = 44100,
) -> None:
    """Generate a sung note name."""
    freq = NOTE_FREQUENCIES[note]
    vowel = NOTE_VOWELS[note]

    print(f"Generating {note} at {freq:.2f} Hz (vowel: {vowel})...")

    # Generate the vowel
    vowel_audio = generate_vowel(freq, vowel, duration, sr)

    # Try to get consonant onset
    consonant = get_consonant_from_tts(note, sr)

    if consonant is not None:
        # Crossfade consonant into vowel
        crossfade_len = int(0.02 * sr)

        # Create output array
        total_len = len(consonant) + len(vowel_audio) - crossfade_len
        output = np.zeros(total_len)

        # Add consonant
        output[:len(consonant)] = consonant

        # Crossfade region
        cf_start = len(consonant) - crossfade_len
        fade_out = np.linspace(1, 0, crossfade_len)
        fade_in = np.linspace(0, 1, crossfade_len)

        output[cf_start:cf_start + crossfade_len] *= fade_out
        output[cf_start:cf_start + crossfade_len] += vowel_audio[:crossfade_len] * fade_in

        # Add rest of vowel
        output[cf_start + crossfade_len:] = vowel_audio[crossfade_len:total_len - cf_start - crossfade_len + crossfade_len]
    else:
        output = vowel_audio

    # Normalize
    max_val = np.max(np.abs(output))
    if max_val > 0:
        output = output / max_val * 0.8

    # Final fade out
    fade_samples = int(0.05 * sr)
    output[-fade_samples:] *= np.linspace(1, 0, fade_samples)

    print(f"    Duration: {len(output)/sr:.2f}s")
    sf.write(output_path, output.astype(np.float32), sr)
    print(f"    Saved to {output_path}")


def main() -> None:
    """Generate sung notes for the C Major scale."""
    output_dir = Path(__file__).parent.parent / "public" / "audio" / "spoken-notes"
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Output directory: {output_dir}\n")
    print("Generating C Major scale (octave 4) synthesized vowels...\n")

    for note in C_MAJOR_SCALE:
        output_path = output_dir / f"{note}4.wav"
        generate_sung_note(note, output_path)
        print()

    print("Done!")


if __name__ == "__main__":
    main()
