from transformers import AutoModelForAudioClassification, AutoFeatureExtractor
import torch
import torch.nn.functional as F
import librosa
import numpy as np

class AudioClassifier:

    def __init__(self,model_name="vocametrix/wav2vec2-xlsr-53-stuttering-classification"):
    # Load model
        self.model_name = model_name
        self.feature_extractor = AutoFeatureExtractor.from_pretrained(self.model_name)
        self.model = AutoModelForAudioClassification.from_pretrained(self.model_name)
        self.model.eval()
        self.audio = ""
        self.sr = ''

    def set_audio(self,audio):

        # Load audio (16 kHz, mono)
        self.audio, self.sr = librosa.load(audio, sr=16000, mono=True)

    def classify(self):
        chunk_duration = 4.0  # seconds
        overlap = 0.50
        chunk_samples = int(chunk_duration * 16000)
        step_samples = int(chunk_samples * (1 - overlap))

        results = []
        pos = 0
        while pos < len(self.audio):
            end = min(pos + chunk_samples, len(self.audio))
            chunk = self.audio[pos:end]
            if len(chunk) < chunk_samples:
                chunk = np.pad(chunk, (0, chunk_samples - len(chunk)))

            inputs = self.feature_extractor(chunk, sampling_rate=16000, return_tensors="pt", padding=True)
            with torch.no_grad():
                logits = self.model(**inputs).logits
                probs = F.softmax(logits, dim=-1)
                pred_id = torch.argmax(probs, dim=-1).item()
                results.append({
                    "start": pos / 16000,
                    "end": end / 16000,
                    "label": self.model.config.id2label[pred_id],
                    "confidence": probs[0][pred_id].item(),
                })
            pos += step_samples
        return results
