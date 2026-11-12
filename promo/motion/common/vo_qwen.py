"""Живая озвучка историй: Qwen3-TTS 1.7B VoiceDesign (Apache 2.0), весь script.txt одним дублем по описанию голоса.
Отдельный venv: pip install torch --index-url https://download.pytorch.org/whl/cpu; pip install qwen-tts soundfile.
    python vo_qwen.py <film>/audio/script.txt full.wav "<описание голоса>" [seed]
Дальше дубль режется по фразам по словам из faster-whisper в <film>/audio/vo/NN.wav и идёт в vo_edit.py."""
import torch, soundfile as sf, time, sys
from qwen_tts import Qwen3TTSModel
torch.set_num_threads(4)
m = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", device_map="cpu", dtype=torch.float32)
ins = sys.argv[3]
text = open(sys.argv[1]).read().strip().replace('«','').replace('»','').replace('\n', ' ')
torch.manual_seed(int(sys.argv[4]) if len(sys.argv) > 4 else 7)
t=time.time()
w, sr = m.generate_voice_design(text=text, language="Russian", instruct=ins, max_new_tokens=1500)
sf.write(sys.argv[2], w[0], sr); print(time.time()-t, len(w[0])/sr)
