"""Verify the real cross-process first-launch lock without touching Windows settings."""
from pathlib import Path
import json
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
script = '''
import json, pathlib, sys, time
sys.path.insert(0, sys.argv[1])
import _windows_integration as integration
folder = pathlib.Path(sys.argv[2])
def install(certificate):
    with (folder / 'calls.txt').open('a') as log: log.write('certificate\\n')
    (folder / 'started').touch()
    deadline = time.monotonic() + 15
    while not (folder / 'release').exists():
        if time.monotonic() >= deadline: raise TimeoutError('Test did not release setup lock')
        time.sleep(.01)
    return True
def register(*args):
    with (folder / 'calls.txt').open('a') as log: log.write('registration\\n')
    return True
integration.install_certificate = install
integration.register_pdf = register
print(json.dumps(integration.initialize_once(b'fake-test-root', r'C:\\Alioth\\test.exe', state_path=folder/'state.json')))
'''
with tempfile.TemporaryDirectory(prefix='first-run-smoke-', dir=ROOT / 'HERRAMIENTAS_DEV/qa-runtime') as directory:
    folder = Path(directory)
    first = subprocess.Popen([sys.executable, '-c', script, str(ROOT), directory], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    import time
    deadline = time.monotonic() + 10
    while not (folder / 'started').exists():
        if first.poll() is not None or time.monotonic() >= deadline:
            raise AssertionError('First setup did not start')
        time.sleep(.01)
    second = subprocess.run([sys.executable, '-c', script, str(ROOT), directory], capture_output=True, text=True, check=True, timeout=10)
    assert json.loads(second.stdout)['busy']
    (folder / 'release').touch()
    output, error = first.communicate(timeout=10)
    assert first.returncode == 0, error
    assert json.loads(output)['certificate']['ok']
    # A new interpreter reads the persisted result and does no setup work.
    third = subprocess.run([sys.executable, '-c', script, str(ROOT), directory], capture_output=True, text=True, check=True, timeout=10)
    assert json.loads(third.stdout)['registration']['ok']
    assert (folder / 'calls.txt').read_text().splitlines() == ['certificate', 'registration']
    proof = {'ok': True, 'crossProcessLock': True, 'newProcessUsesCachedResult': True, 'certificateAndRegistrationCalledOnce': True,
             'realCertificateAndRegistryUntouched': True}
    (ROOT / 'HERRAMIENTAS_DEV/qa-runtime/first-run-3235.json').write_text(json.dumps(proof, indent=2), encoding='utf-8')
    print(json.dumps(proof))
