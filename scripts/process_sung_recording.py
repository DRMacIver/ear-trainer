#!/usr/bin/env python3
"""
Process a sung recording of the C major scale.

Takes a single audio file with all 7 notes sung in sequence (C D E F G A B),
splits them, and autotunes each to the correct pitch in octave 4.
"""

import argparse
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf


# Target frequencies for octave 4
TARGET_FREQUENCIES = {
    "C": 261.63,
    "D": 293.66,
    "E": 329.63,
    "F": 349.23,
    "G": 392.00,
    "A": 440.00,
    "B": 493.88,
}

NOTE_ORDER = ["C", "D", "E", "F", "G", "A", "B"]


def detect_note_segments(
    audio: np.ndarray,
    sr: int,
    min_silence_duration: float = 0.3,
    silence_threshold_db: float = -40,
) -> list[tuple[int, int]]:
    """
    Detect segments of audio separated by silence.
    Returns list of (start_sample, end_sample) tuples.
    """
    # Convert to dB
    rms = librosa.feature.rms(y=audio, frame_length=2048, hop_length=512)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)

    # Find frames above threshold
    is_sound = rms_db > silence_threshold_db

    # Convert to sample indices
    hop_length = 512
    min_silence_frames = int(min_silence_duration * sr / hop_length)

    segments = []
    in_segment = False
    segment_start = 0

    for i, sound in enumerate(is_sound):
        if sound and not in_segment:
            # Start of new segment
            in_segment = True
            segment_start = i
        elif not sound and in_segment:
            # Potential end of segment - check if silence is long enough
            silence_start = i
            silence_end = i
            while silence_end < len(is_sound) and not is_sound[silence_end]:
                silence_end += 1

            if silence_end - silence_start >= min_silence_frames or silence_end >= len(is_sound):
                # End of segment
                segments.append((
                    segment_start * hop_length,
                    i * hop_length
                ))
                in_segment = False

    # Handle case where audio ends while in a segment
    if in_segment:
        segments.append((segment_start * hop_length, len(audio)))

    return segments


def estimate_pitch(audio: np.ndarray, sr: int) -> float:
    """Estimate the fundamental frequency of audio using PYIN."""
    f0, voiced_flag, _ = librosa.pyin(
        audio,
        fmin=librosa.note_to_hz('C2'),
        fmax=librosa.note_to_hz('C6'),
        sr=sr,
    )

    # Get median of voiced frames
    voiced_f0 = f0[voiced_flag]
    if len(voiced_f0) == 0:
        return 0.0

    return float(np.median(voiced_f0))


def pitch_shift_to_target(
    audio: np.ndarray,
    sr: int,
    current_freq: float,
    target_freq: float,
) -> np.ndarray:
    """Pitch shift audio from current frequency to target frequency."""
    if current_freq <= 0:
        print("    Warning: Could not detect pitch, skipping shift")
        return audio

    # Calculate semitones to shift
    semitones = 12 * np.log2(target_freq / current_freq)
    print(f"    Shifting {semitones:+.1f} semitones ({current_freq:.1f} Hz → {target_freq:.1f} Hz)")

    # Use librosa's pitch shift
    shifted = librosa.effects.pitch_shift(
        audio,
        sr=sr,
        n_steps=semitones,
    )

    return shifted


def process_recording(
    input_path: Path,
    output_dir: Path,
    target_duration: float = 3.0,
) -> None:
    """Process a sung recording and output individual autotuned notes."""
    print(f"Loading {input_path}...")
    audio, sr = librosa.load(input_path, sr=None)
    print(f"  Duration: {len(audio)/sr:.1f}s, Sample rate: {sr}Hz")

    # Detect note segments
    print("\nDetecting note segments...")
    segments = detect_note_segments(audio, sr)
    print(f"  Found {len(segments)} segments")

    if len(segments) != 7:
        print(f"\n  Warning: Expected 7 notes, found {len(segments)}")
        print("  Segment boundaries (seconds):")
        for i, (start, end) in enumerate(segments):
            print(f"    {i+1}: {start/sr:.2f}s - {end/sr:.2f}s ({(end-start)/sr:.2f}s)")

        if len(segments) < 7:
            print("\n  Try adjusting silence threshold or check recording has clear gaps")
            return

    # Process each segment
    output_dir.mkdir(parents=True, exist_ok=True)

    for i, (start, end) in enumerate(segments[:7]):
        note = NOTE_ORDER[i]
        target_freq = TARGET_FREQUENCIES[note]

        print(f"\nProcessing {note}4 (segment {i+1})...")
        print(f"  Segment: {start/sr:.2f}s - {end/sr:.2f}s")

        # Extract segment with small padding
        pad = int(0.05 * sr)
        seg_start = max(0, start - pad)
        seg_end = min(len(audio), end + pad)
        segment = audio[seg_start:seg_end]

        # Estimate pitch
        current_freq = estimate_pitch(segment, sr)
        print(f"  Detected pitch: {current_freq:.1f} Hz")

        # Pitch shift to target
        shifted = pitch_shift_to_target(segment, sr, current_freq, target_freq)

        # Trim or pad to target duration
        target_samples = int(target_duration * sr)
        if len(shifted) > target_samples:
            # Trim with fade out
            shifted = shifted[:target_samples]
            fade_len = int(0.1 * sr)
            shifted[-fade_len:] *= np.linspace(1, 0, fade_len)
        elif len(shifted) < target_samples:
            # Pad with silence
            shifted = np.pad(shifted, (0, target_samples - len(shifted)))

        # Normalize
        max_val = np.max(np.abs(shifted))
        if max_val > 0:
            shifted = shifted / max_val * 0.8

        # Fade in/out
        fade_samples = int(0.02 * sr)
        shifted[:fade_samples] *= np.linspace(0, 1, fade_samples)
        shifted[-fade_samples:] *= np.linspace(1, 0, fade_samples)

        # Save
        output_path = output_dir / f"{note}4.wav"
        sf.write(output_path, shifted.astype(np.float32), sr)
        print(f"  Saved to {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Process a sung C major scale recording into individual autotuned notes"
    )
    parser.add_argument(
        "input",
        type=Path,
        help="Input audio file (WAV, MP3, etc.)",
    )
    parser.add_argument(
        "-o", "--output-dir",
        type=Path,
        default=Path(__file__).parent.parent / "public" / "audio" / "spoken-notes",
        help="Output directory for individual note files",
    )
    parser.add_argument(
        "-d", "--duration",
        type=float,
        default=3.0,
        help="Target duration for each note in seconds (default: 3.0)",
    )
    args = parser.parse_args()

    if not args.input.exists():
        print(f"Error: Input file not found: {args.input}")
        return 1

    process_recording(args.input, args.output_dir, args.duration)
    print("\nDone!")
    return 0


if __name__ == "__main__":
    exit(main())
