import json
import sys
from collections import deque

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel


def emit(**event):
    print(json.dumps(event), flush=True)


def listen(model_path, check=False):
    model = WhisperModel(model_path, device="cpu", compute_type="int8", cpu_threads=2, local_files_only=True)
    if check:
        sd.check_input_settings(samplerate=16000, channels=1, dtype="float32")
        emit(ready=True)
        return
    pre_roll = deque(maxlen=3)
    utterance = []
    quiet = 0
    with sd.InputStream(samplerate=16000, channels=1, dtype="float32", blocksize=1600) as microphone:
        emit(ready=True)
        while True:
            samples, overflow = microphone.read(1600)
            if overflow:
                utterance.clear()
                pre_roll.clear()
            samples = samples[:, 0]
            loud = np.sqrt(np.mean(samples * samples)) > 0.008
            if not utterance and not loud:
                pre_roll.append(samples)
                continue
            if not utterance:
                utterance.extend(pre_roll)
                pre_roll.clear()
            utterance.append(samples)
            quiet = 0 if loud else quiet + 1
            if quiet < 6 and len(utterance) < 100:
                continue
            audio = np.concatenate(utterance)
            utterance.clear()
            segments, _ = model.transcribe(audio, language="ar", beam_size=1, vad_filter=True, condition_on_previous_text=False)
            phrase = " ".join(segment.text.strip() for segment in segments).strip()
            if phrase:
                emit(text=phrase)
            available = microphone.read_available
            if available:
                microphone.read(available)


if __name__ == "__main__":
    try:
        listen(sys.argv[1], "--check" in sys.argv[2:])
    except Exception as error:
        emit(error=str(error))
        sys.exit(1)
