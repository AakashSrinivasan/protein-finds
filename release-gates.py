import os,subprocess,json,time
from pathlib import Path
root=Path(__file__).resolve().parent
out=root/'review/recovery-gates';out.mkdir(parents=True,exist_ok=True)
base=os.environ.get('REVIEW_URL','http://127.0.0.1:4321/index.html')
commands=[('consumer-truth',['node','consumer-truth-test.js'],False),('exclusions',['node','--test','exclusion-evidence.test.js'],False),('consumer-flow',['node','consumer-release-flow-test.js'],False),('retailer-links',['node','retailer-link-test.js'],False),('consumer-design',['node','recovery-regression-test.js'],False),('unit-platform',['npm','test'],True),('shell',['npm','run','test:shell'],True),('screen',['npm','run','test:screen'],True),('basket',['npm','run','test:basket'],True),('location',['npm','run','test:location'],True),('journey',['npm','run','test:journey'],True),('a11y',['npm','run','test:a11y'],True),('copy',['npm','run','test:copy'],False),('responsive-review',['npm','run','verify'],True),('pwa',['npm','run','test:pwa'],True),('all-historical-pwa',['node','pwa-history-matrix-test.js'],False)]
rows=[]
for name,cmd,demo in commands:
 target=base+('&' if '?' in base else '?')+'demo=1' if demo else base
 env={**os.environ,'REVIEW_URL':target,'NODE_OPTIONS':f'--require {root}/catalog-mode-guard.js'}
 print(f'RUN {name} target={target}',flush=True)
 start=time.monotonic()
 with (out/(name+'.log')).open('w') as log:
  try:r=subprocess.run(cmd,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=300);code=r.returncode
  except subprocess.TimeoutExpired:code=124
 row={'gate':name,'target':target,'exit_code':code,'seconds':round(time.monotonic()-start,1)};rows.append(row)
 (out/'receipt.json').write_text(json.dumps(rows,indent=2))
 print(json.dumps(row),flush=True)
 if code:print((out/(name+'.log')).read_text()[-7000:],flush=True);raise SystemExit(code)
print('ALL_GATES_PASS',flush=True)
