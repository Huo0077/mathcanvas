import { useEffect, useId, useRef, useState, type MouseEvent } from "react"

import { cropProblemImage, MAX_PROBLEM_IMAGES, prepareProblemImage, type ProblemImage } from "../../services/problemImageFiles"
import { imageReadingText, listImageReaders, readProblemImages, type ImageBox, type ProblemImageReading } from "../../services/problemImageReader"
import { imagePrompt } from "../../services/problemImagePrompt"
import { alignGridReadings } from "../../services/problemImageGrid"
import { graphChoiceDraft, hasVectorSupplement, isDiagramLine, isGraphChoiceProblem, missingGraphChoices, requiredVectorReadings, reviewProblemImage } from "../../services/problemImageReview"
import {
  auditProblemImage,
  diagramItemOf,
  regionOfBox,
  requiredImageGaps,
  type AttachmentHandle,
  type ImageEvidenceAudit,
  type ImageEvidenceGap,
  type ImageEvidenceTarget
} from "../../services/problemImageEvidence"
import { regionToBox, runImageRereadCycle, toOriginalRegion } from "../../services/problemImagePipeline"
import { AgentComposer } from "./AgentComposer"
import { useAgentStore } from "../../agentStore"
import { attachSolveSession, createDefaultSolveSession, dropSolveSession, type SolveSession } from "../../services/solveSession"

interface ProblemImageComposerProps {
  draft: { value: string; onChange: (value: string) => void }
  onSend: (text: string) => Promise<boolean>
  busy: boolean
  initialOpen?: boolean
}

type EvidenceItem = ProblemImageReading["diagram"][number]
type ManualCrop = { item: EvidenceItem; start?: [number, number]; box?: ImageBox }

/** 体积题与图形选择题才有"目标所需证据"；其余题目只记证据、不判定缺口。 */
function imageEvidenceTargetOf(problem: string): ImageEvidenceTarget | undefined {
  if (isGraphChoiceProblem(problem)) return "graph-choice"
  return /体积|容积/.test(problem) ? "volume" : undefined
}

async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) return null
  const view = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await subtle.digest("SHA-256", view)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * 把已提交的题图绑成**附件身份**（W4）。
 *
 * 顺序即模型看到的顺序（图 1、图 2）。任何一张算不出哈希时返回空数组：
 * 那就退回旧语义（只有读数、没有来源），**不伪造**一个哈希。
 */
async function attachmentHandlesOf(images: readonly ProblemImage[], conversationId: string | undefined): Promise<AttachmentHandle[]> {
  const handles: AttachmentHandle[] = []
  for (const [index, image] of images.entries()) {
    let bytes: Uint8Array
    try {
      bytes = Uint8Array.from(atob(image.png), character => character.charCodeAt(0))
    } catch {
      return []
    }
    const sha256 = await sha256Hex(bytes)
    if (sha256 === null) return []
    handles.push({ attachmentId: `image-${index + 1}`, sha256, page: 1, ...(conversationId === undefined ? {} : { conversationId }) })
  }
  return handles
}

export function ProblemImageComposer({ draft, onSend, busy, initialOpen = false }: ProblemImageComposerProps) {
  const panelId = useId()
  const input = useRef<HTMLInputElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const imagePreview = useRef<HTMLDivElement>(null)
  const operation = useRef<AbortController | null>(null)
  const solveSession = useRef<SolveSession | null>(null)
  const sending = useRef(false)
  const [open, setOpen] = useState(initialOpen)
  const [images, setImages] = useState<ProblemImage[]>([])
  const [preview, setPreview] = useState(0)
  const [highlight, setHighlight] = useState<EvidenceItem | null>(null)
  const [readers, setReaders] = useState<Awaited<ReturnType<typeof listImageReaders>> | null>(null)
  const [readerId, setReaderId] = useState("")
  const [refresh, setRefresh] = useState(0)
  const [working, setWorking] = useState<"preparing" | "reading" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState<ProblemImageReading | null>(null)
  const [problem, setProblem] = useState("")
  const [vectorSupplement, setVectorSupplement] = useState("")
  const [graphSupplement, setGraphSupplement] = useState("")
  const [graphReviewed, setGraphReviewed] = useState(false)
  const [reviewed, setReviewed] = useState<number[]>([])
  const [confirmedLines, setConfirmedLines] = useState<number[]>([])
  const [manualCrop, setManualCrop] = useState<ManualCrop | null>(null)
  const [regionalReading, setRegionalReading] = useState<{ item: EvidenceItem; text: string } | null>(null)
  /** W4：本次题图的附件身份、宿主审计结果与**仍未解决**的缺口。 */
  const [attachmentHandles, setAttachmentHandles] = useState<AttachmentHandle[]>([])
  const [imageAudit, setImageAudit] = useState<ImageEvidenceAudit | null>(null)
  const [gaps, setGaps] = useState<ImageEvidenceGap[]>([])
  const [rereads, setRereads] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => () => { operation.current?.abort(); if (solveSession.current) { dropSolveSession(solveSession.current); solveSession.current.cancel("composer closed") } }, [])
  useEffect(() => {
    if (!open) return
    let current = true
    void listImageReaders().then((result) => {
      if (!current) return
      setReaders(result)
      setReaderId((previous) => result.profiles.some((profile) => profile.id === previous)
        ? previous
        : result.profiles.find((profile) => profile.id === result.activeId)?.id ?? result.profiles[0]?.id ?? "")
    })
    return () => { current = false }
  }, [open, refresh])

  function resetBudget() {
    if (solveSession.current) { dropSolveSession(solveSession.current); solveSession.current.cancel("different problem") }
    solveSession.current = null
  }

  function resetReading() {
    setReading(null)
    setProblem("")
    setVectorSupplement("")
    setGraphSupplement("")
    setGraphReviewed(false)
    setHighlight(null)
    setManualCrop(null)
    setReviewed([])
    setConfirmedLines([])
    setRegionalReading(null)
    setAttachmentHandles([])
    setImageAudit(null)
    setGaps([])
    setRereads(0)
  }

  async function addImages(files: File[]) {
    if (!files.length || operation.current || busy || sending.current) return
    setOpen(true)
    const available = MAX_PROBLEM_IMAGES - images.length
    if (available <= 0) {
      setError("同一道题最多添加两张图片。请先移除一张。")
      return
    }
    const controller = new AbortController()
    operation.current = controller
    setWorking("preparing")
    setError(null)
    const prepared: ProblemImage[] = []
    const errors: string[] = []
    if (files.length > available) errors.push("同一道题最多添加两张图片。")
    try {
      for (const file of files.slice(0, available)) {
        try {
          prepared.push(await prepareProblemImage(file))
        } catch (cause) {
          errors.push(cause instanceof Error ? cause.message : "图片读取失败。")
        }
        if (controller.signal.aborted) return
      }
      if (prepared.length) {
        resetBudget()
        resetReading()
        setImages((current) => [...current, ...prepared])
      }
      setError(errors.join(" ") || null)
    } finally {
      if (operation.current === controller && !controller.signal.aborted) {
        operation.current = null
        setWorking(null)
      }
    }
  }

  const reader = readers?.profiles.find((profile) => profile.id === readerId)
  async function recognize(item?: EvidenceItem, selectedBox?: ImageBox) {
    if (!reader || !images.length || operation.current || busy || sending.current) return
    const box = selectedBox ?? item?.box
    const imageIndex = selectedBox || item?.image == null ? preview : item.image - 1
    if (item && (!box || !images[imageIndex])) return
    if (item && box) showEvidence({ ...item, image: imageIndex + 1, box })
    const controller = new AbortController()
    operation.current = controller
    setWorking("reading")
    setError(null)
    try {
      const selectedImages = item && box ? [await cropProblemImage(images[imageIndex], box)] : images
      const session = solveSession.current ?? createDefaultSolveSession(`vision-${crypto.randomUUID()}`)
      solveSession.current = session
      if (!session.resume()) throw new Error("本题识图会话已过期。请重新选择题图。")
      const result = await readProblemImages(reader, selectedImages, `problem-image-${crypto.randomUUID()}`, controller.signal, item !== undefined, session)
      if (controller.signal.aborted) return
      if (item) {
        const text = [result.problem, ...result.diagram.map(imageReadingText), ...result.uncertainties.map(entry => entry.text)].filter(Boolean).join(" · ")
        setRegionalReading({ item, text })
        return
      }
      const aligned = await alignGridReadings(result, selectedImages)
      if (controller.signal.aborted) return
      resetReading()
      setProblem(result.problem)
      /**
       * **宿主自动定向补读**（W4）：首读之后按目标（体积 / 图形选项）判断还缺什么，
       * 缺就裁出对应区域再读，最多 2 次；没有新信息立即停。读到的数值回到核对列表里，
       * 缺口没消就**原样显示**给用户 —— 不允许按常见版本补数。
       */
      const conversationId = useAgentStore.getState().activeConversation?.id
      const handles = await attachmentHandlesOf(images, conversationId)
      if (controller.signal.aborted) return
      setAttachmentHandles(handles)
      const reviewedReading = reviewProblemImage(aligned, selectedImages.length)
      const target = imageEvidenceTargetOf(result.problem)
      const baseInput = {
        attachments: handles,
        ...(conversationId === undefined ? {} : { conversationId }),
        problem: result.problem,
        diagram: reviewedReading.diagram.map(item => diagramItemOf(item)),
        uncertainties: reviewedReading.uncertainties.map(item => diagramItemOf(item)),
        transcriptEdited: false
      }
      let audit = auditProblemImage(baseInput)
      let nextGaps: ImageEvidenceGap[] = target === undefined ? [] : requiredImageGaps(target, audit.facts)
      let used = 0
      if (target !== undefined && handles.length > 0 && reader !== undefined) {
        try {
          const outcome = await runImageRereadCycle({
            ...baseInput,
            target,
            reread: async (request) => {
              const index = handles.findIndex(handle => handle.attachmentId === request.attachmentId)
              const source = images[index]
              if (index < 0 || source === undefined) return []
              const crop = await cropProblemImage(source, regionToBox(request.region))
              const regionRead = await readProblemImages(reader, [crop], `problem-image-reread-${crypto.randomUUID()}`,
                controller.signal, true, session, { missing: request.missing })
              return regionRead.diagram.map(item => ({
                text: item.text,
                image: index + 1,
                box: item.box === null ? regionToBox(request.region) : regionToBox(toOriginalRegion(regionOfBox(item.box), request.region)),
                sourceKind: "ocr" as const
              }))
            }
          })
          if (controller.signal.aborted) return
          audit = outcome.audit
          nextGaps = outcome.required
          used = outcome.used
        } catch (cause) {
          if (controller.signal.aborted) return
          setError("定向补读未完成，已保留首读结果。" + (cause instanceof Error ? `（${cause.message}）` : ""))
        }
      }
      setImageAudit(audit)
      setGaps(nextGaps)
      setRereads(used)
      const knownTexts = new Set(reviewedReading.diagram.map(item => item.text))
      const added = used > 0
        ? audit.facts
            .filter(fact => !knownTexts.has(fact.text) && fact.ref.sourceKind !== "model_guess")
            .map(fact => ({
              text: fact.text,
              image: handles.findIndex(handle => handle.attachmentId === fact.ref.attachmentId) + 1,
              box: regionToBox(fact.ref.region) as ImageBox
            }))
        : []
      setReading(added.length === 0 ? reviewedReading : { ...reviewedReading, diagram: [...reviewedReading.diagram, ...added] })
      if (isGraphChoiceProblem(result.problem)) setGraphSupplement(graphChoiceDraft(result))
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "识别失败，请重试。")
    } finally {
      solveSession.current?.pauseForUser()
      if (operation.current === controller && !controller.signal.aborted) {
        operation.current = null
        setWorking(null)
      }
    }
  }

  function cancelReading() {
    operation.current?.abort()
    operation.current = null
    solveSession.current?.pauseForUser()
    setWorking(null)
  }

  function showEvidence(item: EvidenceItem) {
    if (item.image !== null) setPreview(item.image - 1)
    setManualCrop(null)
    setHighlight(item)
    imagePreview.current?.scrollIntoView?.({ block: "nearest" })
  }

  function startManualCrop(item: EvidenceItem) {
    showEvidence(item)
    setHighlight(null)
    setManualCrop({ item })
  }

  function selectCorner(event: MouseEvent<HTMLImageElement>) {
    if (!manualCrop || working !== null) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const clamp = (value: number) => Math.max(0, Math.min(1, value))
    const x = clamp((event.clientX - bounds.left) / bounds.width)
    const y = clamp((event.clientY - bounds.top) / bounds.height)
    if (!manualCrop.start || manualCrop.box) {
      setManualCrop({ item: manualCrop.item, start: [x, y] })
      return
    }
    const [left, top] = manualCrop.start
    if (Math.abs(x - left) < 0.01 || Math.abs(y - top) < 0.01) return
    setManualCrop({ ...manualCrop, box: [Math.min(left, x), Math.min(top, y), Math.max(left, x), Math.max(top, y)] })
  }

  const vectorReadings = reading ? requiredVectorReadings(reading) : 0
  const graphChoice = reading !== null && isGraphChoiceProblem(reading.problem)
  const missingChoices = graphChoice ? missingGraphChoices(graphSupplement) : []
  const graphReady = !graphChoice || (missingChoices.length === 0 && graphReviewed)
  const needsReview = reading?.uncertainties.some((item, index) => item.impact !== "appearance" && !reviewed.includes(index)) ?? false
  const canUse = Boolean(problem.trim() || draft.value.trim()) && !/\[看不清\]|【看不清】|［看不清］/.test(problem)
    && !needsReview && !manualCrop && graphReady && (vectorReadings === 0 || hasVectorSupplement(vectorSupplement, vectorReadings))

  async function sendReading() {
    if (!reading || !canUse || operation.current || sending.current || busy) return
    sending.current = true
    setSubmitting(true)
    setError(null)
    try {
      const instructions = [
        vectorReadings > 0 ? `配图读数（用户补充）：${vectorSupplement.trim()}` : "",
        graphChoice ? `图形选项（用户核对）：\n${graphSupplement.trim()}` : "",
        draft.value
      ].filter(Boolean).join("\n")
      /**
       * **题图以结构化证据送达**（W4）：附件身份（attachmentId + sha256）、目标、
       * 未解决缺口与重读次数一起随题面走。只发一串备注的话，宿主再也拿不到"这是哪张图"，
       * 也就无法在重读之后让旧证据失效。
       */
      const target = imageEvidenceTargetOf(problem)
      const submissionConversationId = useAgentStore.getState().activeConversation?.id
      const submissionAudit = auditProblemImage({
        attachments: attachmentHandles,
        ...(submissionConversationId === undefined ? {} : { conversationId: submissionConversationId }),
        problem,
        diagram: reading.diagram.map(item => diagramItemOf(item)),
        uncertainties: reading.uncertainties.map(item => diagramItemOf(item)),
        transcriptEdited: problem.trim() !== reading.problem
      })
      const submissionGaps = target === undefined ? submissionAudit.gaps : [...submissionAudit.gaps, ...requiredImageGaps(target, submissionAudit.facts)]
      const auditMeta = attachmentHandles.length === 0 ? undefined : {
        attachments: attachmentHandles.map(handle => ({ attachmentId: handle.attachmentId, sha256: handle.sha256, page: handle.page ?? 1 })),
        ...(target === undefined ? {} : { target }),
        gaps: submissionGaps.map(gap => ({ code: gap.code, message: gap.message, required: gap.required })),
        rereads
      }
      const completePrompt = imagePrompt(problem, instructions, reading, reviewed, confirmedLines, auditMeta)
      setImageAudit(submissionAudit)
      setGaps(target === undefined ? submissionAudit.gaps : requiredImageGaps(target, submissionAudit.facts))
      const session = solveSession.current
      const conversationId = useAgentStore.getState().activeConversation?.id
      if (session && (!conversationId || !attachSolveSession(conversationId, completePrompt, session)))
        throw new Error("识图会话已被占用或已过期，请重新开始本题。")
      let accepted = false
      try { accepted = await onSend(completePrompt) }
      finally { if (!accepted && session) dropSolveSession(session) }
      if (!accepted) throw new Error("题图识别结果未能发送，内容已保留，可以重试。")
      draft.onChange("")
      solveSession.current = null
      resetReading()
      setImages([])
      setPreview(0)
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "题图识别结果未能发送，内容已保留，可以重试。")
    } finally {
      sending.current = false
      setSubmitting(false)
    }
  }
  const activeImage = images[preview]
  const box = manualCrop?.box ?? (highlight?.image === preview + 1 ? highlight.box : null)

  return <div className="problem-image-composer"
    onPaste={(event) => {
      const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"))
      if (!files.length) return
      event.preventDefault()
      void addImages(files)
    }}
    onDragOver={(event) => {
      if (event.dataTransfer.types.includes("Files")) event.preventDefault()
    }}
    onDrop={(event) => {
      if (!event.dataTransfer.files.length) return
      event.preventDefault()
      void addImages(Array.from(event.dataTransfer.files))
    }}
  >
    {open && <section className="problem-image-panel" id={panelId} aria-label="题图识别">
      <header className="problem-image-head">
        <div><h2>题图识别</h2><p>粘贴截图，或分别添加题干与配图。</p></div>
        <button type="button" aria-label="收起题图识别" disabled={submitting} onClick={() => {
          if (working === "reading") cancelReading()
          setOpen(false)
          toggle.current?.focus()
        }}>收起</button>
      </header>
      <input ref={input} type="file" aria-label="选择题图文件" accept="image/png,image/jpeg,image/webp" multiple hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ""
          void addImages(files)
        }} />
      <div className="problem-image-files">
        {images.map((image, index) => <div className="problem-image-file" key={index}>
          <button type="button" className="problem-image-thumbnail" aria-pressed={preview === index} onClick={() => {
            setPreview(index)
            setHighlight(null)
            setManualCrop(current => current && { item: current.item })
          }}>
            <img src={`data:image/png;base64,${image.png}`} alt="" />
            <span title={image.name}>图 {index + 1} · {image.name}</span>
          </button>
          <button type="button" aria-label={`移除图 ${index + 1}`} disabled={working !== null || submitting} onClick={() => {
            resetBudget()
            setImages((current) => current.filter((_, item) => item !== index))
            setPreview(0)
            setError(null)
            resetReading()
          }}>×</button>
        </div>)}
        <button type="button" disabled={images.length >= MAX_PROBLEM_IMAGES || working !== null || busy || submitting} onClick={() => input.current?.click()}>添加图片</button>
      </div>
      {activeImage && <div className="problem-image-preview" ref={imagePreview}>
        <figure>
          <img src={`data:image/png;base64,${activeImage.png}`} alt={`图 ${preview + 1} 预览`} onClick={manualCrop ? selectCorner : undefined}
            className={manualCrop ? "problem-image-crop-target" : undefined} />
          {manualCrop?.start && !box && <span className="problem-image-crop-corner" aria-hidden="true"
            style={{ left: `${manualCrop.start[0] * 100}%`, top: `${manualCrop.start[1] * 100}%` }} />}
          {box && <span className="problem-image-highlight" data-image-highlight="true" aria-hidden="true" style={{
            left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%`
          }} />}
        </figure>
        {manualCrop && <div className="problem-image-crop-controls">
          <p role="status">{box ? "已框选。也可以重新点选。" : manualCrop.start ? "请点击选区的另一个角。" : "请在预览上依次点击选区的两个对角。"}</p>
          <button type="button" disabled={!manualCrop.box || !reader || busy || working !== null}
            onClick={() => { void recognize(manualCrop.item, manualCrop.box) }}>重读框选区域</button>
          <button type="button" onClick={() => setManualCrop(null)}>取消框选</button>
        </div>}
      </div>}
      <div className="problem-image-service">
        <label>视觉模型<select aria-label="视觉模型" value={readerId} disabled={!readers?.profiles.length || working !== null} onChange={(event) => setReaderId(event.target.value)}>
          {!readers?.profiles.length && <option value="">暂无可用模型</option>}
          {readers?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.modelId} · {profile.networkPolicy === "cloud" ? "云端" : profile.networkPolicy === "lan" ? "局域网" : "本机"}</option>)}
        </select></label>
        {working === "reading"
          ? <button type="button" onClick={cancelReading}>停止识别</button>
          : <button type="button" className="agent-send" disabled={!images.length || !reader || working !== null || busy || submitting} onClick={() => { void recognize() }}>识别题图</button>}
      </div>
      {!readers ? <p role="status">正在读取视觉模型…</p> : readers.profiles.length === 0
        ? <p>{readers.error ?? "请在「设置 → 模型服务」验证支持图像的模型。已有配置可展开「查看能力详情」检查原因。"} <button type="button" onClick={() => { setReaders(null); setRefresh((value) => value + 1) }}>刷新模型</button></p>
        : reader?.networkPolicy === "cloud" && <p>识别时会将选中的题图发送给上方的云端模型。</p>}
      {working && <p role="status">{working === "preparing" ? "正在准备图片…" : "正在读取题干与配图…"}</p>}
      {error && <p className="agent-composer-refusal" role="alert">{error}</p>}
      {reading && <div className="problem-image-review">
        <label>识别的题干<textarea value={problem} onChange={(event) => { setProblem(event.target.value); setReviewed([]) }} readOnly={submitting} rows={4} maxLength={8000} /></label>
        {vectorReadings > 0 && <label>
          补充配图向量
          <span>缺少向量的起点或箭头方向。请对照原图逐支填写 {vectorReadings} 组坐标，例如「船速：(2,0) → (3,3)」。</span>
          <textarea value={vectorSupplement} onChange={event => setVectorSupplement(event.target.value)} readOnly={submitting} rows={2} maxLength={1200} />
        </label>}
        {graphChoice && <label>
          补充图形选项
          <span>{missingChoices.length > 0 ? `缺少选项 ${missingChoices.join("、")} 的曲线特征。` : "选项已齐，请对照原图核对。"}每行填写一项，例如「A：关于 y 轴对称，两端下降」。</span>
          <textarea value={graphSupplement} onChange={event => {
            setGraphSupplement(event.target.value)
            setGraphReviewed(false)
          }} readOnly={submitting} rows={4} maxLength={1600} />
        </label>}
        {graphChoice && <label className="problem-image-checkbox">
          <input type="checkbox" disabled={submitting || missingChoices.length > 0} checked={graphReviewed}
            onChange={event => setGraphReviewed(event.target.checked)} /> 已对照原图核对各选项曲线
        </label>}
        {reading.uncertainties.length > 0 && <div className="problem-image-uncertain">
          <h3>识别疑点</h3>
          {reading.uncertainties.map((item, index) => <div key={index}>
            <button type="button" onClick={() => showEvidence(item)}>{item.image === null ? "原图" : `图 ${item.image}`} · {item.text}</button>
            <label><input type="checkbox" checked={reviewed.includes(index)} disabled={submitting}
              aria-label={`已核对疑点 ${index + 1}`}
              onChange={(event) => {
                const checked = event.target.checked
                setReviewed(current => checked ? [...current, index] : current.filter(value => value !== index))
              }} /> 已核对</label>
            {item.box && <button type="button" disabled={!reader || busy || working !== null || submitting}
              aria-label={`重读疑点 ${index + 1}`} onClick={() => { void recognize(item) }}>重读选区</button>
            }
            <button type="button" disabled={!reader || busy || working !== null || submitting}
              aria-label={`框选疑点 ${index + 1}`} onClick={() => startManualCrop(item)}>{item.box ? "重选区域" : "框选重读"}</button>
            {regionalReading?.item === item && <p role="status">选区读数 · {regionalReading.text}</p>}
          </div>)}
        </div>}
        {reading.diagram.length > 0 && <details className="problem-image-observations">
          <summary>配图参考 · {reading.diagram.length} 条</summary>
          <p>点名和数值可随题发送。请对照原图勾选要发送的线条。</p>
          {reading.diagram.map((item, index) => <div className="problem-image-observation" key={index}>
            <span>{imageReadingText(item)}{!item.box && "（位置待核对）"}</span>
            <div className="problem-image-observation-actions">
              {item.box && <button type="button" aria-label={`定位配图读数 ${index + 1}`} onClick={() => showEvidence(item)}>定位</button>}
              {isDiagramLine(item) && <label>
                <input type="checkbox" checked={confirmedLines.includes(index)} disabled={submitting}
                  aria-label={`确认并发送线条：${item.text}`}
                  onChange={event => {
                    const checked = event.target.checked
                    setConfirmedLines(current => checked ? [...current, index] : current.filter(value => value !== index))
                  }} /> 确认并发送
              </label>}
            </div>
          </div>)}
        </details>}
        {imageAudit !== null && imageAudit.facts.length > 0 && <p className="problem-image-evidence-summary" role="status">
          已绑定图证据 {imageAudit.facts.length} 条（附件 {attachmentHandles.length} 张），定向重读 {rereads} 次。
        </p>}
        {gaps.some(gap => gap.required) && <div className="problem-image-gaps" role="status">
          <h3>图证据缺口</h3>
          <ul>{gaps.filter(gap => gap.required).map((gap, index) => <li key={index}>{gap.message}</li>)}</ul>
          <p>可先框选补读。直接发送会按「未完成」处理，不会按常见版本补数。</p>
        </div>}
        <div className="problem-image-apply">
          {/\[看不清\]|【看不清】|［看不清］/.test(problem) && <p>请先修正题干里的「[看不清]」。</p>}
          {needsReview && <p>请定位并核对可能影响题意的疑点，必要时先修正题干。</p>}
          {!problem.trim() && !draft.value.trim() && <p>请补充题干，或说明要根据配图完成什么。</p>}
          <button type="button" className="agent-send" disabled={!canUse || working !== null || busy || submitting} onClick={() => { void sendReading() }}>
            {submitting ? "正在发送…" : "发送给 Agent"}
          </button>
        </div>
      </div>}
    </section>}
    <AgentComposer draft={draft} onSend={onSend} busy={busy} disabled={open}
      leadingAction={<button ref={toggle} type="button" className="problem-image-toggle" aria-controls={panelId} aria-expanded={open} disabled={submitting}
        onClick={() => { if (open && working === "reading") cancelReading(); setOpen((current) => !current) }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="m4 17 5-5 3 3 3-4 5 6" />
        </svg>
        图片识题{images.length > 0 ? ` · ${images.length}` : ""}
      </button>} />
  </div>
}
