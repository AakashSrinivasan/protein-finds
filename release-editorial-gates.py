import os
import pathlib
import subprocess
import time
import urllib.request

root = pathlib.Path(__file__).resolve().parent
os.chdir(root)
url = os.environ.get('REVIEW_URL', 'http://127.0.0.1:4187/index.html')
local = url.startswith('http://127.0.0.1:4187/')
server = subprocess.Popen(['python3', '-m', 'http.server', '4187'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) if local else None
try:
    if local:
        for attempt in range(30):
            try:
                served = urllib.request.urlopen(url.replace('index.html', 'app-shell.css')).read()
                break
            except OSError:
                time.sleep(.2)
        assert served == (root / 'app-shell.css').read_bytes()
    out = root / 'review/editorial'
    out.mkdir(exist_ok=True)
    label = 'local' if local else 'production'
    with (out / f'{label}-gates.txt').open('w') as receipt:
        gates = ['test', 'verify', 'test:screen', 'test:basket', 'test:a11y', 'test:copy', 'test:shell', 'test:location', 'test:journey', 'test:pwa']
        for gate in gates:
            log = out / f'{label}-{gate.replace(":", "-")}.log'
            with log.open('w') as stream:
                result = subprocess.run(['npm', 'run', gate], env=dict(os.environ, REVIEW_URL=url), stdout=stream, stderr=subprocess.STDOUT)
            line = f'TARGET={url} GATE={gate} EXIT={result.returncode}'
            print(line, flush=True)
            receipt.write(line + '\n')
            receipt.flush()
            if result.returncode:
                print(log.read_text()[-14000:])
                raise SystemExit(result.returncode)
    subprocess.run(['git', 'diff', '--check'], check=True)
    subprocess.run(['node', 'release-editorial-capture.js'], env=dict(os.environ, REVIEW_URL=url), check=True)
finally:
    if server:
        server.terminate()
        server.wait()
