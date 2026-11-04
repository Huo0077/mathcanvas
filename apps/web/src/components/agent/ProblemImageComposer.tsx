import { useEffect, useId, useRef, useState } from "react"

import { MAX_PROBLEM_IMAGES, prepareProblemImage, type ProblemImage } from "../../services/problemImageFiles"
import { listImageReaders, readProblemImages, type ProblemImageReading } from "../../services/problemImageReader"
import { imagePrompt } from "../../services/problemImagePrompt"
import { AgentComposer } from "./AgentComposer"

interface ProblemImageComposerProps {
  draft: { value: string; onChange: (value: string) => void }
  onSend: (text: string) => Promise<boolean>
  busy: boolean
  initialOpen?: boolean
}

type EvidenceItem = ProblemImageReading["diagram"][number]

export function ProblemImageComposer({ draft, onSend, busy, initialOpen = false }: ProblemImageComposerProps) {
  const panelId = useId()
  const input = useRef<HTMLInputElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const imagePreview = useRef<HTMLDivElement>(null)
  const operation = useRef<AbortController | null>(null)
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
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => () => operation.current?.abort(), [])
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

  function resetReading() {
    setReading(null)
    setProblem("")
    setHighlight(null)
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
  async function recognize() {
    if (!reader || !images.length || operation.current || busy) return
    const controller = new AbortController()
    operation.current = controller
    setWorking("reading")
    setError(null)
    try {
      const result = await readProblemImages(reader, images, `problem-image-${crypto.randomUUID()}`, controller.signal)
      if (controller.signal.aborted) return
      resetReading()
      setReading(result)
      setProblem(result.problem)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "识别失败，请重试。")
    } finally {
      if (operation.current === controller && !controller.signal.aborted) {
        operation.current = null
        setWorking(null)
      }
    }
  }

  function cancelReading() {
    operation.current?.abort()
    operation.current = null
    setWorking(null)
  }

  function showEvidence(item: EvidenceItem) {
    setPreview(item.image - 1)
    setHighlight(item)
    imagePreview.current?.scrollIntoView?.({ block: "nearest" })
  }

  const canUse = Boolean(problem.trim() || draft.value.trim()) && !problem.includes("[看不清]")

  async function sendReading() {
    if (!reading || !canUse || operation.current || sending.current || busy) return
    sending.current = true
    setSubmitting(true)
    setError(null)
    try {
      const accepted = await onSend(imagePrompt(problem, draft.value, reading.diagram.map((item) => item.text)))
      if (!accepted) throw new Error("题图识别结果未能发送，内容已保留，可以重试。")
      draft.onChange("")
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
  const box = highlight?.image === preview + 1 ? highlight.box : null

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
          <button type="button" className="problem-image-thumbnail" aria-pressed={preview === index} onClick={() => { setPreview(index); setHighlight(null) }}>
            <img src={`data:image/png;base64,${image.png}`} alt="" />
            <span title={image.name}>图 {index + 1} · {image.name}</span>
          </button>
          <button type="button" aria-label={`移除图 ${index + 1}`} disabled={working !== null || submitting} onClick={() => {
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
          <img src={`data:image/png;base64,${activeImage.png}`} alt={`图 ${preview + 1} 预览`} />
          {box && <span className="problem-image-highlight" data-image-highlight="true" aria-hidden="true" style={{
            left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%`
          }} />}
        </figure>
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
        <label>识别的题干<textarea value={problem} onChange={(event) => setProblem(event.target.value)} readOnly={submitting} rows={4} maxLength={8000} /></label>
        {reading.uncertainties.length > 0 && <div className="problem-image-uncertain">
          <h3>识别疑点</h3>
          {reading.uncertainties.map((item, index) => <button type="button" key={index} onClick={() => showEvidence(item)}>图 {item.image} · {item.text}</button>)}
        </div>}
        {reading.diagram.length > 0 && <details className="problem-image-observations">
          <summary>配图参考 · {reading.diagram.length} 条</summary>
          <p>随题发送，供作图参考。</p>
          {reading.diagram.map((item, index) => <div className="problem-image-observation" key={index}>
            <span>{item.text}</span>
            <button type="button" aria-label={`定位配图读数 ${index + 1}`} onClick={() => showEvidence(item)}>定位</button>
          </div>)}
        </details>}
        <div className="problem-image-apply">
          {problem.includes("[看不清]") && <p>请先修正题干里的「[看不清]」。</p>}
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
