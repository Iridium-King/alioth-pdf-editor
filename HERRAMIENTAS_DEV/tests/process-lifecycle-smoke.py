"""Exercise real Windows handles against an isolated, windowless test helper only."""
from pathlib import Path
import json
import os
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from _process_lifecycle import WindowsProcess, reap_inactive_hosts, track_host

folder = ROOT / '_qa_process_lifecycle_3235'
folder.mkdir(exist_ok=True)
source = folder / 'IdleHost.cs'
helper = folder / 'AliothPDFHost.exe'
source.write_text('class IdleHost { static void Main() { System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite); } }', encoding='utf-8')
compiler = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
subprocess.run([str(compiler), '/nologo', '/target:winexe', '/out:' + str(helper), str(source)], check=True)
ledger = folder / 'records'
child = subprocess.Popen([str(helper)], creationflags=subprocess.CREATE_NO_WINDOW)
orphan_pid = None
try:
    track_host(child, helper, directory=ledger)
    assert len(list(ledger.glob('*.json'))) == 1
    assert reap_inactive_hosts(directory=ledger, now=time.time() + 121) == 0
    assert child.poll() is None, 'A live backend must keep its host on startup'
    assert reap_inactive_hosts(directory=ledger, allow_current=True) == 0, 'Slow startup is protected'
    assert reap_inactive_hosts(directory=ledger, allow_current=True, now=time.time() + 121) == 1
    child.wait(timeout=5)
    script = '''
import pathlib, subprocess, sys
sys.path.insert(0, sys.argv[1])
from _process_lifecycle import track_host
helper, ledger = sys.argv[2:]
p = subprocess.Popen([helper], creationflags=subprocess.CREATE_NO_WINDOW)
track_host(p, helper, directory=ledger)
print(p.pid, flush=True)
'''
    result = subprocess.run([sys.executable, '-c', script, str(ROOT), str(helper), str(ledger)],
                            capture_output=True, text=True, check=True, timeout=15)
    orphan_pid = int(result.stdout.strip())
    assert reap_inactive_hosts(directory=ledger, now=time.time() + 121) == 1
    assert not list(ledger.glob('*.json'))
    proof = {'ok': True, 'realProcessHandle': True, 'liveOwnerPreserved': True,
             'startupGracePreserved': True, 'idleHostTerminated': True, 'deadOwnerOrphanTerminated': True}
    (ROOT / 'HERRAMIENTAS_DEV/qa-runtime/process-lifecycle-3235.json').write_text(json.dumps(proof, indent=2), encoding='utf-8')
    print(json.dumps(proof))
finally:
    if child.poll() is None:
        child.terminate()
        child.wait(timeout=5)
    # Clean only remaining helpers whose full recorded identity still matches.
    for path in ledger.glob('*.json'):
        record = json.loads(path.read_text(encoding='utf-8'))
        expected = record['host']
        with WindowsProcess(expected['pid'], terminate=True) as process:
            if process.identity() == expected and not process.has_windows():
                process.terminate()
