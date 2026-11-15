"""One-time model download. Runtime speech never downloads models or sends audio out."""
import hashlib
import json
import os
from pathlib import Path
import urllib.request
import shutil
from importlib.util import find_spec

ROOT = Path(os.environ.get('REHEARSAL_VOICE_DIR', Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'Rehearsal' / 'voice'))
REVISION = '3d3d5dee26484f91867d81cb899cfcf72b96be6c'
PIPER_REVISION = 'b4e358ffcb232591bf73a540e70f7de528e4174a'
ASSETS = {
    'kokoro-v1.0.onnx': 325532387,
    'voices-v1.0.bin': 28214398,
}

def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    # eSpeak's C file I/O cannot reliably open a Unicode OneDrive path on Windows.
    import espeakng_loader
    shutil.copytree(espeakng_loader.get_data_path(), ROOT / 'espeak-ng-data', dirs_exist_ok=True)
    piper_package = Path(find_spec('piper').origin).parent
    shutil.copytree(piper_package / 'espeak-ng-data', ROOT / 'piper-data', dirs_exist_ok=True)
    manifest = {}
    for name, length in ASSETS.items():
        destination = ROOT / name
        if not destination.exists() or destination.stat().st_size != length:
            partial = destination.with_suffix(destination.suffix + '.partial')
            url = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/' + name
            print('Downloading ' + name, flush=True)
            with urllib.request.urlopen(url, timeout=90) as response, partial.open('wb') as target:
                while chunk := response.read(1024 * 1024):
                    target.write(chunk)
            if partial.stat().st_size != length:
                raise RuntimeError('Incomplete download: ' + name)
            partial.replace(destination)
        with destination.open('rb') as source:
            manifest[name] = {'bytes': length, 'sha256': hashlib.file_digest(source, 'sha256').hexdigest()}
    from huggingface_hub import snapshot_download
    print('Downloading pinned English recognition model', flush=True)
    snapshot_download('Systran/faster-whisper-base.en', revision=REVISION,
                      local_dir=ROOT / 'base.en', allow_patterns=['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt'])
    snapshot_download('rhasspy/piper-voices', revision=PIPER_REVISION, local_dir=ROOT / 'piper',
        allow_patterns=['en/en_US/lessac/medium/en_US-lessac-medium.onnx', 'en/en_US/lessac/medium/en_US-lessac-medium.onnx.json', 'en/en_US/lessac/medium/MODEL_CARD'])
    manifest['base.en'] = {'repository': 'Systran/faster-whisper-base.en', 'revision': REVISION}
    manifest['piper'] = {'repository': 'rhasspy/piper-voices', 'revision': PIPER_REVISION, 'voice': 'en_US-lessac-medium'}
    (ROOT / 'models.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('Voice models ready at ' + str(ROOT), flush=True)

if __name__ == '__main__':
    main()
