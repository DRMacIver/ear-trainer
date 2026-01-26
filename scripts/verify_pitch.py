#!/usr/bin/env python3
"""
Verify the pitch of generated audio files matches their target frequencies.
"""

from pathlib import Path

import numpy as np
import soundfile as sf


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


def estimate_pitch_autocorr(audio: np.ndarray, sr: int) -> float:
    """
    Estimate fundamental frequency using autocorrelation.
    Returns the estimated pitch in Hz.
    """
    # Use a window from the middle of the audio (avoid attack/release)
    window_size = int(0.1 * sr)  # 100ms window
    start = len(audio) // 2 - window_size // 2
    end = start + window_size

    if end > len(audio):
        start = len(audio) - window_size
        end = len(audio)

    segment = audio[start:end]

    # Remove DC offset
    segment = segment - np.mean(segment)

    # Autocorrelation
    corr = np.correlate(segment, segment, mode='full')
    corr = corr[len(corr) // 2:]  # Take positive lags only

    # Find first peak after initial decay
    # Skip the first few samples (very short periods = very high freq)
    min_period = int(sr / 1000)  # 1000 Hz max
    max_period = int(sr / 50)    # 50 Hz min

    # Find the highest peak in the valid range
    search_region = corr[min_period:max_period]
    if len(search_region) == 0:
        return 0.0

    peak_idx = np.argmax(search_region) + min_period

    if corr[peak_idx] <= 0:
        return 0.0

    # Convert period to frequency
    freq = sr / peak_idx
    return freq


def estimate_pitch_fft(audio: np.ndarray, sr: int) -> float:
    """
    Estimate fundamental frequency using FFT.
    Returns the estimated pitch in Hz.
    """
    # Use a window from the middle
    window_size = int(0.2 * sr)  # 200ms window
    start = len(audio) // 2 - window_size // 2
    end = start + window_size

    if end > len(audio):
        start = len(audio) - window_size
        end = len(audio)

    segment = audio[start:end]

    # Apply window function
    window = np.hanning(len(segment))
    segment = segment * window

    # FFT
    fft = np.fft.rfft(segment)
    freqs = np.fft.rfftfreq(len(segment), 1/sr)
    magnitudes = np.abs(fft)

    # Find peaks in reasonable frequency range (50-1000 Hz)
    valid_mask = (freqs >= 50) & (freqs <= 1000)
    valid_freqs = freqs[valid_mask]
    valid_mags = magnitudes[valid_mask]

    if len(valid_mags) == 0:
        return 0.0

    # Find the dominant frequency
    peak_idx = np.argmax(valid_mags)
    return valid_freqs[peak_idx]


def freq_to_cents(measured: float, target: float) -> float:
    """Calculate cents difference between measured and target frequency."""
    if measured <= 0 or target <= 0:
        return float('inf')
    return 1200 * np.log2(measured / target)


def main() -> None:
    audio_dir = Path(__file__).parent.parent / "public" / "audio" / "spoken-notes"

    print("Pitch Verification Report")
    print("=" * 60)
    print()

    for note in ["C", "D", "E", "F", "G", "A", "B"]:
        filepath = audio_dir / f"{note}4.wav"
        if not filepath.exists():
            print(f"{note}4: FILE NOT FOUND")
            continue

        audio, sr = sf.read(filepath)
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        target_freq = NOTE_FREQUENCIES[note]

        # Estimate pitch using both methods
        pitch_autocorr = estimate_pitch_autocorr(audio, sr)
        pitch_fft = estimate_pitch_fft(audio, sr)

        cents_autocorr = freq_to_cents(pitch_autocorr, target_freq)
        cents_fft = freq_to_cents(pitch_fft, target_freq)

        print(f"{note}4 (target: {target_freq:.1f} Hz)")
        print(f"  Autocorrelation: {pitch_autocorr:.1f} Hz ({cents_autocorr:+.0f} cents)")
        print(f"  FFT:             {pitch_fft:.1f} Hz ({cents_fft:+.0f} cents)")

        # Verdict
        best_cents = min(abs(cents_autocorr), abs(cents_fft))
        if best_cents < 50:
            verdict = "OK"
        elif best_cents < 100:
            verdict = "CLOSE"
        else:
            verdict = "WRONG"
        print(f"  Verdict: {verdict}")
        print()


if __name__ == "__main__":
    main()
