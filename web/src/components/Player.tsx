import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'

export interface PlayerHandle {
  play(): void
  pause(): void
  toggle(): void
  seekTo(seconds: number): void
  seekBy(delta: number): void
  setRate(rate: number): void
  toggleMute(): void
  fullscreen(): void
}

export interface PlayerState {
  position: number
  duration: number
  playing: boolean
  buffered: number
}

interface Props {
  videoId: string
  /** Serve from /media/:id instead of the YouTube embed. */
  local: boolean
  startAt: number
  rate: number
  onState: (s: PlayerState) => void
  onEnded: () => void
  ref: Ref<PlayerHandle>
}

// ---- YouTube IFrame API loader ------------------------------------------------
declare global {
  interface Window {
    YT?: any
    onYouTubeIframeAPIReady?: () => void
  }
}
let ytReady: Promise<any> | null = null
function loadYouTube(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!ytReady) {
    ytReady = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        prev?.()
        resolve(window.YT)
      }
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    })
  }
  return ytReady
}

/**
 * One component, two backends: the YouTube embed (default) or a native <video> for downloaded files.
 * Native controls stay on in both cases (YouTube's own scrubber is excellent on touch); our chrome
 * lives *around* the player, not on top of it.
 */
export default function Player({ videoId, local, startAt, rate, onState, onEnded, ref }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const ytRef = useRef<any>(null)
  const onStateRef = useRef(onState)
  const onEndedRef = useRef(onEnded)
  onStateRef.current = onState
  onEndedRef.current = onEnded

  // ---- YouTube backend
  useEffect(() => {
    if (local) return
    let cancelled = false
    let poll: ReturnType<typeof setInterval> | undefined
    loadYouTube().then((YT) => {
      if (cancelled || !mountRef.current) return
      const el = document.createElement('div')
      mountRef.current.replaceChildren(el)
      ytRef.current = new YT.Player(el, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, start: Math.floor(startAt) },
        events: {
          onReady: (e: any) => {
            e.target.setPlaybackRate(rate)
            poll = setInterval(() => {
              const p = ytRef.current
              if (!p?.getCurrentTime) return
              onStateRef.current({
                position: p.getCurrentTime() || 0,
                duration: p.getDuration() || 0,
                playing: p.getPlayerState() === YT.PlayerState.PLAYING,
                buffered: (p.getVideoLoadedFraction?.() || 0) * (p.getDuration() || 0),
              })
            }, 500)
          },
          onStateChange: (e: any) => {
            if (e.data === YT.PlayerState.ENDED) onEndedRef.current()
          },
        },
      })
    })
    return () => {
      cancelled = true
      if (poll) clearInterval(poll)
      try {
        ytRef.current?.destroy?.()
      } catch {
        /* ignore */
      }
      ytRef.current = null
    }
    // Recreate per video: loadVideoById is flaky with `start` + autoplay across browsers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, local])

  // ---- native backend
  useEffect(() => {
    if (!local) return
    const v = videoRef.current
    if (!v) return
    v.currentTime = startAt
    v.playbackRate = rate
    const emit = () =>
      onStateRef.current({
        position: v.currentTime,
        duration: v.duration || 0,
        playing: !v.paused && !v.ended,
        buffered: v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0,
      })
    const ended = () => onEndedRef.current()
    v.addEventListener('timeupdate', emit)
    v.addEventListener('play', emit)
    v.addEventListener('pause', emit)
    v.addEventListener('ended', ended)
    v.play().catch(() => {})
    return () => {
      v.removeEventListener('timeupdate', emit)
      v.removeEventListener('play', emit)
      v.removeEventListener('pause', emit)
      v.removeEventListener('ended', ended)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, local])

  useEffect(() => {
    if (local) {
      if (videoRef.current) videoRef.current.playbackRate = rate
    } else ytRef.current?.setPlaybackRate?.(rate)
  }, [rate, local])

  useImperativeHandle(ref, () => {
    const yt = () => ytRef.current
    const vid = () => videoRef.current
    const isPlaying = () => (local ? !!vid() && !vid()!.paused : yt()?.getPlayerState?.() === 1)
    const h: PlayerHandle = {
      play: () => (local ? vid()?.play() : yt()?.playVideo?.()),
      pause: () => (local ? vid()?.pause() : yt()?.pauseVideo?.()),
      toggle: () => (isPlaying() ? h.pause() : h.play()),
      seekTo: (s) => {
        if (local) {
          if (vid()) vid()!.currentTime = s
        } else yt()?.seekTo?.(s, true)
      },
      seekBy: (d) => {
        const cur = local ? vid()?.currentTime ?? 0 : yt()?.getCurrentTime?.() ?? 0
        h.seekTo(Math.max(0, cur + d))
      },
      setRate: (r) => (local ? vid() && (vid()!.playbackRate = r) : yt()?.setPlaybackRate?.(r)),
      toggleMute: () => {
        if (local) {
          if (vid()) vid()!.muted = !vid()!.muted
        } else if (yt()?.isMuted?.()) yt().unMute()
        else yt()?.mute?.()
      },
      fullscreen: () => {
        const el = wrapRef.current
        if (!el) return
        if (document.fullscreenElement) void document.exitFullscreen()
        else if (el.requestFullscreen) void el.requestFullscreen()
        else (vid() as any)?.webkitEnterFullscreen?.()
      },
    }
    return h
  }, [local])

  return (
    <div ref={wrapRef} className="relative aspect-video w-full bg-black">
      {local ? (
        <video ref={videoRef} key={videoId} src={`/media/${videoId}`} controls playsInline className="size-full" />
      ) : (
        <div ref={mountRef} className="size-full [&>iframe]:size-full" />
      )}
    </div>
  )
}
