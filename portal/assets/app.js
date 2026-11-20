/* global window, document, navigator, CSS, HTMLDialogElement, HTMLImageElement, HTMLVideoElement, HTMLMediaElement, IntersectionObserver */
(() => {
  // 1. Accessible Tab Switching + hidden="until-found" beforematch support
  const tablist = document.querySelector('[role="tablist"]')
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'))

  function selectTab(targetTab, { moveFocus = false } = {}) {
    if (!targetTab) return
    for (const tab of tabs) {
      const selected = tab === targetTab
      tab.setAttribute("aria-selected", String(selected))
      tab.setAttribute("tabindex", selected ? "0" : "-1")
    }
    for (const panel of panels) {
      const owns = panel.getAttribute("aria-labelledby") === targetTab.id
      if (owns) {
        panel.removeAttribute("hidden")
        panel.setAttribute("tabindex", "0")
      } else {
        panel.setAttribute("hidden", "until-found")
        panel.removeAttribute("tabindex")
      }
    }
    targetTab.scrollIntoView({ block: "nearest", inline: "nearest", container: "nearest" })
    if (moveFocus) targetTab.focus()
  }

  if (tablist && tabs.length > 0) {
    for (const tab of tabs) {
      const isSelected = tab.getAttribute("aria-selected") === "true"
      tab.setAttribute("tabindex", isSelected ? "0" : "-1")
      tab.addEventListener("click", () => selectTab(tab))
    }

    tablist.addEventListener("keydown", (event) => {
      const current = document.activeElement
      const idx = tabs.indexOf(current)
      if (idx < 0) return
      let nextIdx = -1
      if (event.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length
      else if (event.key === "ArrowLeft") nextIdx = (idx - 1 + tabs.length) % tabs.length
      else if (event.key === "Home") nextIdx = 0
      else if (event.key === "End") nextIdx = tabs.length - 1
      if (nextIdx >= 0) {
        event.preventDefault()
        selectTab(tabs[nextIdx], { moveFocus: true })
      }
    })

    for (const panel of panels) {
      panel.addEventListener("beforematch", () => {
        const tabId = panel.getAttribute("aria-labelledby")
        const owner = tabs.find((t) => t.id === tabId)
        if (owner) selectTab(owner)
      })
    }
  }

  // 2. Native <dialog closedby="any"> Lightbox with Safari backdrop fallback
  const lightbox = document.getElementById("mediaLightbox")
  const lightboxImg = document.getElementById("lightboxImg")
  const lightboxTitle = document.getElementById("lightboxTitle")
  const lightboxCaption = document.getElementById("lightboxCaption")

  if (lightbox instanceof HTMLDialogElement && lightboxImg instanceof HTMLImageElement) {
    document.querySelectorAll("[data-lightbox-img]").forEach((trigger) => {
      trigger.addEventListener("click", () => {
        const src = trigger.getAttribute("data-lightbox-img") || ""
        const title = trigger.getAttribute("data-lightbox-title") || "界面预览"
        lightboxImg.src = src
        lightboxImg.alt = title
        if (lightboxTitle) lightboxTitle.textContent = title
        if (lightboxCaption) lightboxCaption.textContent = title
        lightbox.showModal()
      })
    })

    if (!("closedBy" in HTMLDialogElement.prototype)) {
      lightbox.addEventListener("click", (event) => {
        if (event.target !== lightbox) return
        const rect = lightbox.getBoundingClientRect()
        const inBox =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width
        if (!inBox) lightbox.close()
      })
    }
  }

  // 3. Video chapter seeking + reduced-motion safety + native lazy-media fallback
  const demoVideo = document.getElementById("demoVideo")
  const chapterBtns = Array.from(document.querySelectorAll(".chapter-btn"))
  if (demoVideo instanceof HTMLVideoElement) {
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const pauseIfReduced = (prefersReduced) => {
      if (prefersReduced && demoVideo.hasAttribute("autoplay")) {
        demoVideo.removeAttribute("autoplay")
        demoVideo.pause()
      }
    }
    pauseIfReduced(reducedMotionQuery.matches)
    reducedMotionQuery.addEventListener("change", (event) => pauseIfReduced(event.matches))

    chapterBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const sec = Number(btn.getAttribute("data-seek") || "0")
        chapterBtns.forEach((item) => item.classList.remove("is-active"))
        btn.classList.add("is-active")
        demoVideo.currentTime = Number.isFinite(sec) ? sec : 0
        void demoVideo.play().catch(() => {})
      })
    })

    if (!Object.hasOwn(HTMLMediaElement.prototype, "loading")) {
      const poster = demoVideo.getAttribute("poster")
      const preload = demoVideo.getAttribute("preload")
      if (poster) {
        demoVideo.dataset.poster = poster
        demoVideo.removeAttribute("poster")
      }
      if (preload && preload !== "none") {
        demoVideo.dataset.preload = preload
      }
      demoVideo.preload = "none"
      const mediaObserver = new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            if (demoVideo.dataset.poster) {
              demoVideo.poster = demoVideo.dataset.poster
              delete demoVideo.dataset.poster
            }
            if (demoVideo.dataset.preload) {
              demoVideo.preload = demoVideo.dataset.preload
              delete demoVideo.dataset.preload
            }
            demoVideo.load()
            observer.unobserve(demoVideo)
          }
        },
        { rootMargin: "200px 0px" }
      )
      mediaObserver.observe(demoVideo)
    }
  }

  // 4. Copy helpers with clear feedback
  document.querySelectorAll("[data-copy-text]").forEach((button) => {
    button.addEventListener("click", async () => {
      const text = button.getAttribute("data-copy-text")
      if (!text) return
      const original = button.textContent
      try {
        await navigator.clipboard.writeText(text)
        button.textContent = "已复制 ✓"
      } catch {
        button.textContent = "请手动选择复制"
      }
      window.setTimeout(() => {
        button.textContent = original
      }, 1800)
    })
  })

  // 5. User-controlled prompt example switcher (WCAG 2.2.2 compliant — no unrequested auto-rotation)
  const ticker = document.getElementById("heroPromptText")
  const nextPromptBtn = document.getElementById("nextPromptBtn")
  if (ticker && nextPromptBtn) {
    const samples = [
      "在四棱锥 P-ABCD 中，PA⊥平面 ABCD，E 为 PB 中点，连接 AE、CE → 自动推导「面 AEC」",
      "若双曲线 y² - x²/m² = 1 的渐近线与圆 x² + y² - 4y + 3 = 0 相切 → 自动绘制渐近线与切圆",
      "在正四面体中取面内动点 M 并旋转视角 → 实时计算二面角及 sin / cos 精确值",
      "由 3D 立体模型一键切换至工程制图 → 自动生成主视 / 俯视 / 左视 / 轴测四视图"
    ]
    let sampleIndex = 0
    nextPromptBtn.addEventListener("click", () => {
      sampleIndex = (sampleIndex + 1) % samples.length
      ticker.textContent = samples[sampleIndex]
    })
  }

  // 6. Scroll reveal fallback for browsers without animation-timeline: view()
  if (
    !CSS.supports("(animation-timeline: view()) and (animation-range: entry)") &&
    window.matchMedia("(prefers-reduced-motion: no-preference)").matches
  ) {
    const cards = Array.from(document.querySelectorAll(".reveal-card"))
    for (const card of cards) {
      card.style.opacity = "0.2"
      card.style.transform = "translateY(16px)"
      card.style.transition = "opacity 0.45s ease, transform 0.45s ease"
    }
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const el = entry.target
          el.style.opacity = "1"
          el.style.transform = "translateY(0)"
          observer.unobserve(el)
        }
      },
      { threshold: 0.12 }
    )
    cards.forEach((card) => revealObserver.observe(card))
  }
})()
