import json, pathlib, collections, hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
BASE=ROOT/'eval-results/real-exams-20261105'
OUT=ROOT/'docs/audit/artifacts/2026-11-05-real-exams'
OUT.mkdir(parents=True,exist_ok=True)
qs=json.loads((ROOT/'test-fixtures/real-exams-20261105/cases.json').read_text(encoding='utf8'))
def read(run,id):return json.loads((BASE/run/(id+'.json')).read_text(encoding='utf8'))
rs=[read('baseline',q['id']) for q in qs]
fixids={'mm-000','mm-012','mm-058'}
fix=[read('material-corrected',q['id']) for q in qs if q['id'] in fixids]
merged=[next(x for x in fix if x['id']==r['id']) if r['id'] in fixids else r for r in rs]
def metrics(rows):
 n=len(rows); delivered=sum(r['deliverySuccess'] for r in rows);answered=sum(r['score']['answered'] for r in rows);correct=sum(r['endToEndCorrect'] for r in rows)
 return dict(total=n,delivered=delivered,answered=answered,correct=correct,deliveryRate=delivered/n,accuracy=correct/n,conditionalAccuracy=correct/answered if answered else None,visionParsed=sum(bool(r['reading']) for r in rows if r['visionRequired']),visionRequired=sum(r['visionRequired'] for r in rows))
def tokens(run):
 inp=out=cnt=0;models=set()
 for p in (BASE/run).glob('*-requests.json'):
  for r in json.loads(p.read_text(encoding='utf8')):
   cnt+=1
   for e in r.get('response',[]):
    if e['kind']=='usage':inp+=e.get('inputTokens',0);out+=e.get('outputTokens',0)
    if e['kind']=='started' and e.get('model'):models.add(e['model'])
 return dict(requests=cnt,inputTokens=inp,outputTokens=out,reportedModels=sorted(models))
rawsummary=json.loads((BASE/'baseline/summary.json').read_text(encoding='utf8'))
assert len(rs)==50 and len(fix)==3
assert sum(r['requests'] for r in rs)==rawsummary['totalRequests']==118
assert sum(r['endToEndCorrect'] for r in rs)==rawsummary['correct']==26
assert all(r['liveWrites']==0 for r in rs+fix)
assert all(not r.get('timedOut') for r in rs+fix)
# Immutable source and original image integrity; sheet hashes track the two material versions.
for q in qs:
 for im in q['images']:assert hashlib.sha256((ROOT/im['file']).read_bytes()).hexdigest()==im['sha256']
material=[]
for q in qs:
 if q.get('sheet'):
  original=BASE/'baseline/input-sheets'/pathlib.Path(q['sheet']).name
  current=ROOT/q['sheet']
  material.append(dict(id=q['id'],firstRunSha256=hashlib.sha256(original.read_bytes()).hexdigest(),currentSha256=hashlib.sha256(current.read_bytes()).hexdigest(),mislabelledFirstRun=q['id'] in fixids))
assert {x['id'] for x in material if x['firstRunSha256']!=x['currentSha256']}==fixids
summary={'date':'2026-11-05','revision':rawsummary['revision'],'model':rawsummary['model'],'rawBaseline':metrics(rs),'materialValidFirstRun47':metrics([r for r in rs if r['id'] not in fixids]),'materialCorrectionIntermediate3':metrics([read('material-corrected-intermediate',q['id']) for q in qs if q['id'] in fixids]),'materialCorrected3':metrics(fix),'compositeAfterMaterialCorrection_NOT_singleRun':metrics(merged),'baselineVision':metrics([r for r in rs if r['visionRequired']]),'baselineText':metrics([r for r in rs if not r['visionRequired']]),'usage':{run:tokens(run) for run in ['baseline','material-corrected-intermediate','material-corrected','pilot']},'additionalCapabilityProbeRequests':4,'totalNativeRequests':150,'costKnown':False,'materialAudit':material,'sourceQualityFlags':{'text-151':'option C formula damaged upstream','text-178':'triangle symbol became square upstream','mm-051':'reference derivation has 24/25 typo; final sqrt(7) verified'},'results':rawsummary['results'],'correctionResults':json.loads((BASE/'material-corrected/summary.json').read_text(encoding='utf8'))['results']}
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
notes={
'128':('C','设焦距参数c²=a²+b²，垂足P=(a²/c,ab/c)，OP=a，PF₁²=c²+3a²=6a²，故e=√3。'),
'131':('C','将复数动点条件化为圆，圆心为(0,1)。'),
'137':('C','z=-3+2i，共轭复数对应(-3,-2)。'),
'139':('D','令a=r/R，原式给M₂/M₁=a²[(1+a)−(1+a)⁻²]≈3a³，故r≈R·∛(M₂/(3M₁))。'),
'142':('B','平面内两条相交直线都平行另一平面，可判两平面平行；只有一条不充分。'),
'143':('D','题设给p/2=√(2p)，p>0，解得p=8。'),
'151':('A','F=(√6,0)，由PO=PF得P的横坐标√6/2，渐近线给纵坐标绝对值√3/2，面积3√2/4；选项C上游损坏。'),
'158':('B','标准抛物线参数p=1，焦点为(1/2,0)。'),
'163':('A','设两焦半径u、v，有uv=8、(u−v)²=4a²、u²+v²=4c²，得b²=4；e=√5给b=2a，故a=1。'),
'167':('C','抛物线焦点距离关系：12=9+p/2，得p=6。'),
'176':('B','圆心只能为(r,r)，过(2,1)得r²−6r+5=0，即r=1或5；两圆心到直线距离均为2/√5。'),
'178':('B','按源解析的三角形ODE理解，面积条件给ab=8；两焦点距离关系最小值8。题干三角符号损坏，需标记。'),
'180':('C','球半径2，截面三角形外接圆半径√3，球心到截面距离√(4−3)=1。'),
'186':('A','设短焦半径r、长焦半径3r；余弦定理给4c²=7r²，焦半径之差给a=r，故e=√7/2。'),
'190':('A','AC⊥BC且两边为1，底面积1/2、外接圆半径√2/2；球半径1，锥高√2/2，体积√2/12。'),
'198':('C','设t=sinθ，PB²=(b²−a²)t²−2b²t+a²+b²。最大值不超过4b²要求a²≤2b²，故0<e≤√2/2。'),
'203':('D','相邻连分数收敛子交错：偶数项递增、奇数项递减，且偶数项均小于奇数项，故b₄<b₇。'),
'204':('B','抛物线焦点F=(1,0)，BF=2，AF=x_A+1=2得x_A=1、y_A=±2，故AB=√(4+4)=2√2。'),
'206':('C','最优底面为截面圆内接正方形，四棱锥体积V(h)正比h(1−h²)，导数1−3h²=0，0<h<1取h=1/√3。'),
'212':('A','两弦斜率积给b²/a²=1/4，离心率√(1−1/4)=√3/2。')}
audit=['# 参考答案复核记录','', '复核者：本次执行助手，独立代数/几何复算；不是第二位阅卷教师签署，不认证 Agent 的完整证明。源答案未进入模型请求。', '', '|题号|参考选项|复核要点|','|---|---|---|']
for k,(answer,note) in notes.items():
 q=next(q for q in qs if q['id']=='text-'+k);assert q['expected']==[answer];audit.append(f'|text-{k}|{answer}|{note}|')
audit+=['','额外检查：mm-000 有 d(t)=2|sin(t−π/4)|，首零点π/4，对应C；mm-012 有f(x)=|sin2x|/2，峰高1/2，对应C；mm-051取正方形边长2，BM=√7、EN=2，且为三角形BDE的两中线所在直线，共面相交，对应B。其余图题以独立上游标准选项评分，未声称已逐一人工完整证明。']
(OUT/'reference-audit.md').write_text('\n'.join(audit)+'\n',encoding='utf8')
def pct(x):return f'{100*x:.1f}%'
def row(label,rows):
 m=metrics(rows);return f"|{label}|{m['total']}|{m['delivered']}（{pct(m['deliveryRate'])}）|{m['correct']}（{pct(m['accuracy'])}）|{m['answered']}|"
report=['# 高考真题 Agent 实测报告','', '日期：2026-11-05；产品基线：v4.3.0，提交 `'+rawsummary['revision']+'`。','', '## 1. 结论','', '**当前样本的端到端选项准确率为26/50＝52.0%，不能说已经可靠解决高考题。** 文字题明显好于配图题。首轮交付43/50＝86.0%，但“流程完成”不等于“有最终答案”或“答对”：有5道题虽然 completed，却没有有效A–D最终选项。','', '|口径|题数|交付数/率|答对数/全部题准确率|有效选项数|','|---|---:|---:|---:|---:|',row('首轮全部',rs),row('首轮配图', [r for r in rs if r['visionRequired']]),row('首轮文字',[r for r in rs if not r['visionRequired']]),row('排除3道错标材料的首轮', [r for r in rs if r['id'] not in fixids]),row('材料修正中间轮3题',[read('material-corrected-intermediate',q['id']) for q in qs if q['id'] in fixids]),row('最终材料修正复测3题',fix),row('材料修正后合并观察（非同轮）',merged),'', '首轮已有明确选项的准确率为26/38＝68.4%。最终材料修正后的合并观察为29/39＝74.4%。合并观察共答对29/50＝58.0%，但不是同一轮运行，不能与首轮52%直接比较为产品提升。条件准确率均不能替代全题准确率。','', '## 2. 题源与样本范围','', '- 50道2010–2022年公开高考客观题，30道配图、20道文本，57张原始配图。题型偏向立体几何、三视图、体积与圆锥曲线，也含少量复数、递推及应用题。工作区分配29道geometry3d、21道conics。不是随机抽样，不代表所有高考数学题。','- 来源为 OpenMOSS/GAOKAO-MM 与 OpenLMLab/GAOKAO-Bench 的固定提交；源地址、SHA256、题号和上游解析逐题保留。属于整理数据，不冒充考试机构原卷扫描。数据目录保留两份上游许可证及归属说明。','- **本轮尚未纳入已核验的著名联考/模拟题**，未声称完成这部分覆盖。下一批需要有可追溯原卷、原图与参考解，不用自编题冒充。','- 抽样题号在正式结果前固定，没有根据模型答对情况挑题；不把项目原有合成夹具计入成绩。公开题有训练集污染风险。','- 参考选项来自上游独立答案，不由受测Agent自产自评。20道文字题另做独立复算，记录见同目录artifacts的reference-audit.md；未认证每道题的完整证明。','', '## 3. 真实链路与评测口径','', '- 当前桌面保存的模型配置是 `deepseek-v4-flash`，配置revision=1；服务实际事件报告模型名为 `deepseek-flash`。本报告保留这个差异，不替供应商推断底层模型版本。正式前真实能力探测确认工具、JSON、识图和流式响应可用。','- 配图题均实际调用产品 `readProblemImages`。读图结果经 `imagePrompt/splitImagePrompt` 进入产品 `createModelPlanner` 和 `createAgentRuntime`，再走协调器、计划编译和核验。没有模拟模型返回，没有人工将识图遗漏的关系补给模型。','- 识图输入为原始题干文本和原图拼接的PNG；LaTeX是原文形式，不是渲染公式。不是原卷整页截图，结果不能直接外推到手机拍照卷。','- 每题使用空白隔离文档；禁止自动确认或写入用户项目。本次写入用户文档次数为0。没有为提高基线成绩修改产品Agent。','- 核心提示要求必要推导及“最终答案：X”，有需要才出图。因此不要求每题都生成草稿，**不能据此统计作图成功率**。实际仅2题出现草稿对象，最终都失败；没有成功交付经核验图形的证据。','- 交付：无异常/超时且completed，或awaiting_confirmation且有实际草稿；等待用户澄清不算自主交付。','- 准确：仅从最终用户可见答案抽取唯一明确A–D，与参考选项严格一致；没有选项、冲突结论、拒答、识图失败均不算答对。答案正确不等于推导正确。','- 范围不包含AgentRunner特殊前置本地路由、UI点击、画布渲染和拖动。这是产品核心链路实测，不是所有浏览器UI的端到端验收。','', '## 4. 材料问题与复测（不隐瞒、不择优）','', '首轮新增图注曾按“5张图中第一张是题图”排版，mm-000、mm-012、mm-058实际为A–D选项在前、主图在后，造成图注错标。所有其他4/5图题已查看原图核对。错标是评测材料责任，不能直接归因Agent。','', '首轮完整保留，旧图片在本地 `baseline/input-sheets`。材料修正经历两轮，完整保留，不取最好：第一修正轮新增中文图注受终端编码影响变成“??”，字母A–D与原图不变，3题分别选B/B/C，0/3正确；发现编码问题后将最终中文图注修正，再复测同3题，分别选C/C/D，3/3正确。最终合并观察为29/50＝58%，交付44/50＝88%。报告不掩盖中间轮；材料不同且模型采样有波动，不能归因于Agent本身提升，也不能从3题估计总体能力。正式单轮主指标仍保留首轮52%，无错标材料的首轮47题为55.3%。','', '上游另有质量问题：text-151的选项C公式损坏；text-178的三角形符号被识为方框；mm-051解析中存在24/25笔误。都已标记，不悄悄改题。剔除前两道有题干/选项瑕疵的文字题，该文字子集为13/18答对（72.2%），样本不同不可混称主指标。','', '## 5. 实际暴露的问题与优先级','', '|优先级|证据|问题|建议实施与验收|','|---|---|---|---|','|P0|mm-035、mm-051、text-190|answer最大512字符，长解答多轮修复仍过不了schema|先统一提示、工具schema、解析器的长度约束；将简短结论与长推导拆字段；用以上长答案和图形修复案例做回归，禁止简单截断数学结论。|','|P0|text-139、text-190；mm-063|模型使用未知字段normalisations，或把读工具与plan_set_plan混在同批，最终失败|校准工具约束及示例；提供确定性的格式纠错，读/写批次分离，保留现有拒绝不安全混批的边界；验收时既要完成又不发生部分执行。|','|P0|首轮mm-000；修正复测mm-000、mm-012|识图框越界使解析失败，或描述不保留曲线起始趋势/峰高/选项标识；最后即使公式正确也匹配错选项|对无效框定点重读，不静默接受；保留各选项独立裁图、刻度、端点趋势和虚实线。要求读出的选项与原图可定位；格式成功率与内容正确率分开验收。|','|P1|mm-005、mm-009、mm-075|三视图尺寸/视图对应丢失，体积不在选项仍猜选项或只能请求清晰图|建立长对正、高平齐、宽相等的结构化视图解析；提取网格和尺寸证据，至少两种体积核验。不匹配时主动重读，禁止为了贴选项修改已算结果。|','|P1|text-128、text-198|代数关系和不等式方向算错，短答案仍被当成完成|引入可复核代数步骤/数值反例检验：离心率边界、驻点是否落区间、公式量纲；选项与推导矛盾不能直接结束。|','|P1|mm-011、mm-036、mm-056、mm-059、mm-075|completed但无有效最终选项，其中有解释、半截输出或请求补图|将求解状态、澄清状态和最终答案字段分开；终态不能仅由无草稿决定。验收不把解释或“最终答案X”算作答题成功。|','|P2|现有样本覆盖|无已核验联考/模拟题、无主观证明和真实UI作图评分|下一批固定至少100题，分高考/联考、2D/3D、文本/拍照，分别记分；保存原卷出处和教师参考解，做盲测及多次独立运行。|','', '本轮没有直接修以上产品问题；先保存基线，后续修复应在同一题集与独立新题集上分别复测，避免只记住这50题。','', '## 6. 识图、调用量与成本','', '- 首轮识图结构可解析29/30＝96.7%；最终材料修正复测3/3。合并观察30/30结构可解析。**这是格式可解析率，不是识图内容准确率。** 未建立逐框标注真值，不给虚假的OCR准确率。配图首轮端到端正确仅11/30＝36.7%；最终材料修正合并观察为14/30＝46.7%，不是同轮。','- 正式首轮118次原生provider调用；材料修正中间轮8次、最终轮12次；预检8次、能力探测4次，合计150次。底层若自行重试，实际计费HTTP数可能不同。未核实价格，金额未知。','- 首轮usage：输入389145 tokens、输出56143；材料修正中间轮输入24517、输出4374；最终轮usage详见统计JSON；预检输入32554、输出3101。能力探测未在这份token求和内。每题180秒、每请求90秒，均未触发题级超时。','- 评测框架测试passed仅表示禁止写文档等断言通过，不代表数学题通过。评分器9个单元测试通过，脚本TypeScript检查通过；原始图像SHA256核对通过。','', '## 7. 逐题结果（首轮）','', '“—”表示没有唯一明确的A–D结论；终态保留真实运行状态。所有行分母均保留。','', '|ID|年份/卷别/题号|参考|输出|终态|正确|备注|','|---|---|---|---|---|---|---|']
for q,r in zip(qs,rs):
 note='首轮图注错标，已单独复测' if q['id'] in fixids else summary['sourceQualityFlags'].get(q['id'],'')
 report.append(f"|{q['id']}|{q['year']} {q['paper']} {q['questionNumber']}|{''.join(q['expected'])}|{r['score']['choice'] or '—'}|{r['terminal']}|{'是' if r['endToEndCorrect'] else '否'}|{note}|")
report+=['','## 8. 证据与复现','', '- 实施口径：`docs/audit/2026-11-05-real-exam-evaluation-protocol.md`。','- 固定题库及许可证：`test-fixtures/real-exams-20261105/`。','- 工具说明：`scripts/real-exam-eval/README.md`；汇总：`scripts/real-exam-eval/summarize.py`。','- 可随仓库保存的统计、输入版本哈希和答案复核：`docs/audit/artifacts/2026-11-05-real-exams/`。','- 本地完整模型日志、识图结果、草稿、事件：`eval-results/real-exams-20261105/baseline/` 和 `material-corrected/`。该目录被仓库忽略，未宣称已上传GitHub。','- 所有改动均为评测工具、题库和文档；没有提交、推送或发布版本。','']
(ROOT/'docs/audit/2026-11-05-real-exam-agent-evaluation-report.md').write_text('\n'.join(report),encoding='utf8')
print(json.dumps({k:v for k,v in summary.items() if k not in ['results','correctionResults','materialAudit']},ensure_ascii=False,indent=2))
