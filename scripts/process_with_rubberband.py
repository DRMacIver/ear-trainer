#!/usr/bin/env python3
"""
Process sung recording using rubberband for high-quality pitch shifting.

Uses rubberband's R3 (fine) engine with formant preservation for best quality.
"""

import argparse
import subprocess
import tempfile
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf


# Target frequencies for octave 3 (lower octave for natural male voice)
TARGET_FREQUENCIES_O3 = {
    "C": 130.81,
    "D": 146.83,
    "E": 164.81,
    "F": 174.61,
    "G": 196.00,
    "A": 220.00,
    "B": 246.94,
}

NOTE_ORDER = ["C", "D", "E", "F", "G", "A", "B"]


def detect_note_segments(
    audio: np.ndarray,
    sr: int,
    min_silence_duration: float = 0.15,
    silence_threshold_db: float = -30,
) -> list[tuple[int, int]]:
    """Detect segments of audio separated by silence."""
    rms = librosa.feature.rms(y=audio, frame_length=2048, hop_length=512)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    is_sound = rms_db > silence_threshold_db

    hop_length = 512
    min_silence_frames = int(min_silence_duration * sr / hop_length)

    segments = []
    in_segment = False
    segment_start = 0

    for i, sound in enumerate(is_sound):
        if sound and not in_segment:
            in_segment = True
            segment_start = i
        elif not sound and in_segment:
            silence_start = i
            silence_end = i
            while silence_end < len(is_sound) and not is_sound[silence_end]:
                silence_end += 1

            if silence_end - silence_start >= min_silence_frames or silence_end >= len(is_sound):
                segments.append((segment_start * hop_length, i * hop_length))
                in_segment = False

    if in_segment:
        segments.append((segment_start * hop_length, len(audio)))

    # Filter out very short segments (likely noise)
    min_segment_duration = 0.5  # at least 0.5 seconds
    min_segment_samples = int(min_segment_duration * sr)
    segments = [(s, e) for s, e in segments if (e - s) >= min_segment_samples]

    return segments


def estimate_pitch(audio: np.ndarray, sr: int) -> float:
    """Estimate fundamental frequency using PYIN."""
    f0, voiced_flag, _ = librosa.pyin(
        audio,
        fmin=librosa.note_to_hz('C2'),
        fmax=librosa.note_to_hz('C6'),
        sr=sr,
    )
    voiced_f0 = f0[voiced_flag]
    if len(voiced_f0) == 0:
        return 0.0
    return float(np.median(voiced_f0))


def pitch_shift_rubberband(
    input_path: Path,
    output_path: Path,
    semitones: float,
) -> bool:
    """Use rubberband for high-quality pitch shifting with formant preservation."""
    try:
        result = subprocess.run(
            [
                "rubberband",
                "--fine",           # R3 engine for best quality
                "--formant",        # Preserve formants
                "-p", str(semitones),
                str(input_path),
                str(output_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return True
    except subprocess.CalledProcessError as e:
        print(f"    Rubberband error: {e.stderr}")
        return False


def process_recording(
    input_path: Path,
    output_dir: Path,
    target_duration: float = 3.0,
) -> None:
    """Process a sung recording using rubberband for pitch correction."""
    print(f"Loading {input_path}...")
    audio, sr = librosa.load(input_path, sr=None)
    print(f"  Duration: {len(audio)/sr:.1f}s, Sample rate: {sr}Hz")

    print("\nDetecting note segments...")
    segments = detect_note_segments(audio, sr)
    print(f"  Found {len(segments)} segments")

    if len(segments) != 7:
        print(f"\n  Warning: Expected 7 notes, found {len(segments)}")
        for i, (start, end) in enumerate(segments):
            print(f"    {i+1}: {start/sr:.2f}s - {end/sr:.2f}s ({(end-start)/sr:.2f}s)")
        if len(segments) < 7:
            return

    output_dir.mkdir(parents=True, exist_ok=True)

    for i, (start, end) in enumerate(segments[:7]):
        note = NOTE_ORDER[i]
        target_freq = TARGET_FREQUENCIES_O3[note]

        print(f"\nProcessing {note}3 (segment {i+1})...")
        print(f"  Segment: {start/sr:.2f}s - {end/sr:.2f}s")

        # Extract segment with padding
        pad = int(0.05 * sr)
        seg_start = max(0, start - pad)
        seg_end = min(len(audio), end + pad)
        segment = audio[seg_start:seg_end]

        # Estimate pitch
        current_freq = estimate_pitch(segment, sr)
        print(f"  Detected pitch: {current_freq:.1f} Hz")

        if current_freq <= 0:
            print("    Warning: Could not detect pitch, using raw segment")
            shifted = segment
        else:
            # Calculate semitones needed
            semitones = 12 * np.log2(target_freq / current_freq)
            print(f"  Shift needed: {semitones:+.2f} semitones ({current_freq:.1f} Hz → {target_freq:.1f} Hz)")

            # If shift is very small, skip it
            if abs(semitones) < 0.1:
                print("    Shift < 0.1 semitones, using raw segment")
                shifted = segment
            else:
                # Save segment to temp file for rubberband
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_in:
                    sf.write(tmp_in.name, segment.astype(np.float32), sr)

                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_out:
                        print(f"    Applying rubberband (R3 engine + formant preservation)...")
                        if pitch_shift_rubberband(Path(tmp_in.name), Path(tmp_out.name), semitones):
                            shifted, _ = sf.read(tmp_out.name)
                        else:
                            print("    Rubberband failed, using raw segment")
                            shifted = segment

                        Path(tmp_out.name).unlink(missing_ok=True)
                    Path(tmp_in.name).unlink(missing_ok=True)

        # Trim or pad to target duration
        target_samples = int(target_duration * sr)
        if len(shifted) > target_samples:
            shifted = shifted[:target_samples]
            fade_len = int(0.1 * sr)
            shifted[-fade_len:] *= np.linspace(1, 0, fade_len)
        elif len(shifted) < target_samples:
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
        output_path = output_dir / f"{note}3.wav"
        sf.write(output_path, shifted.astype(np.float32), sr)
        print(f"  Saved to {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Process sung scale using rubberband for high-quality pitch shifting"
    )
    parser.add_argument("input", type=Path, help="Input audio file")
    parser.add_argument(
        "-o", "--output-dir",
        type=Path,
        default=Path(__file__).parent.parent / "public" / "audio" / "spoken-notes",
        help="Output directory",
    )
    parser.add_argument(
        "-d", "--duration",
        type=float,
        default=3.0,
        help="Target duration in seconds (default: 3.0)",
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
