import json,re,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
run=lambda *args: subprocess.run(args,cwd=root,capture_output=True,text=True,check=True).stdout
rows=json.loads(run('gh','api','repos/AakashSrinivasan/protein-finds/deployments?per_page=100'))
result=[]
for row in rows:
 sha=row['sha'];files={}
 for name in ['service-worker.js','index.html','app.js']:
  p=subprocess.run(['git','show',f'{sha}:{name}'],cwd=root,capture_output=True,text=True)
  files[name]=p.stdout if p.returncode==0 else ''
 match=re.search(r"const CACHE\s*=\s*['\"]([^'\"]+)",files['service-worker.js'])
 statuses=json.loads(run('gh','api',f"repos/AakashSrinivasan/protein-finds/deployments/{row['id']}/statuses"))
 result.append({'deploymentId':row['id'],'sha':sha,'createdAt':row['created_at'],'success':any(s['state']=='success' for s in statuses),'cache':match.group(1) if match else None,'registrationInCommit':any('serviceWorker.register' in f for f in files.values())})
out=root/'review/recovery/worker-history.json';out.parent.mkdir(exist_ok=True,parents=True);out.write_text(json.dumps(result,indent=2))
groups={}
for r in result:
 if r['success'] and r['registrationInCommit'] and r['cache']: groups.setdefault(r['cache'],r['sha'])
print(json.dumps(groups,indent=2));print(f'Wrote {out} with {len(result)} deployment records')
