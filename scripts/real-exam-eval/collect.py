import urllib.request,json,re,hashlib,concurrent.futures
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
out=ROOT/'test-fixtures/real-exams-20261105';(out/'images').mkdir(parents=True,exist_ok=True)
repos={'mm':'OpenMOSS/GAOKAO-MM','text':'OpenLMLab/GAOKAO-Bench'}
files={'mm':'Data/2010-2023_Math_MCQs.json','text':'Data/Objective_Questions/2010-2022_Math_I_MCQs.json'}
manifest={};datasets={}
lock=json.loads((out/'sources.json').read_text(encoding='utf8')) if (out/'sources.json').exists() else {}
for kind,repo in repos.items():
 sha=lock[kind]['commit'] if kind in lock else json.load(urllib.request.urlopen(f'https://api.github.com/repos/{repo}/commits/main',timeout=30))['sha']
 url=f'https://raw.githubusercontent.com/{repo}/{sha}/{files[kind]}'
 raw=urllib.request.urlopen(url,timeout=40).read()
 if kind in lock and hashlib.sha256(raw).hexdigest()!=lock[kind]['sha256']:raise ValueError('Pinned source hash mismatch: '+kind)
 datasets[kind]=json.loads(raw)['example']
 manifest[kind]={'repo':repo,'commit':sha,'url':url,'sha256':hashlib.sha256(raw).hexdigest()}
 (out/(kind+'-source.json')).write_bytes(raw)
vi=[0,3,5,8,9,11,12,14,15,17,20,22,24,25,29,33,34,35,36,41,51,55,56,58,59,60,63,66,68,75]
# Choose latest twenty eligible geometry questions, fixed before any model results.
eligible=[i for i,x in enumerate(datasets['text']) if re.search('棱|锥|柱|球|几何体|椭圆|双曲线|抛物线|体积|平面|圆心',x['question']) and not re.search('如图|下图|右图|图所示|冰球|短道',x['question'])]
ti=[128,131,137,139,142,143,151,158,163,167,176,178,180,186,190,198,203,204,206,212]
cases=[];jobs=[]
for kind,indices in [('mm',vi),('text',ti)]:
 for i in indices:
  x=datasets[kind][i];id=f'{kind}-{i:03d}';images=[]
  for n,path in enumerate(x.get('picture',[])):
   rel=path.removeprefix('../');url=f"https://raw.githubusercontent.com/{repos[kind]}/{manifest[kind]['commit']}/{rel}"
   target=out/'images'/f'{id}-{n}.png';images.append({'file':str(target.relative_to(ROOT)).replace('\\','/'),'url':url});jobs.append((url,target,images[-1]))
  solid=bool(re.search('棱|锥|柱|球|几何体|多面体|四面体|三视图|体积|表面积|平面.*平面',x['question']))
  cases.append({'id':id,'year':x['year'],'paper':x['category'],'questionNumber':re.match(r'\d+',x['question']).group(0),'question':x['question'],'expected':x['answer'],'analysis':x['analysis'],'workspace':'geometry3d' if solid else 'conics','images':images,'source':manifest[kind],'originalIndex':i})
def download(job):
 url,target,item=job
 for attempt in range(3):
  try:
   b=urllib.request.urlopen(url,timeout=35).read();target.write_bytes(b);item['sha256']=hashlib.sha256(b).hexdigest();return
  except Exception:
   if attempt==2:raise
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:list(pool.map(download,jobs))
(out/'cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2),encoding='utf8')
(out/'sources.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
print(f'Collected {len(cases)} questions, {len(jobs)} original images; text indices {ti}')
