import { useEffect, useRef } from 'react'
import { useStore, type Step } from '../store'
import { ordToIso, isoToOrd } from '../lib/data'

export default function TimeMachine() {
  const { ord, minOrd, maxOrd, playing, speed, step, compareOrd, setOrd, setPlaying, setSpeed, setStep, setCompareOrd, reducedMotion } = useStore()
  const tick = useStore((s) => s.tick)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!playing) return
    timer.current = window.setInterval(tick, 1000 / speed)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [playing, speed, tick])

  const inc = step === 'day' ? 1 : step === 'week' ? 7 : 30
  const iso = ordToIso(ord)

  return (
    <div className="timeline" role="group" aria-label="Historical time machine">
      <div className="tl-controls">
        <button className="btn" aria-label="Rewind to start" title="Rewind to start" onClick={() => setOrd(minOrd)}>
          ⏮
        </button>
        <button className="btn" aria-label="Step back" title={`Back one ${step}`} onClick={() => setOrd(ord - inc)}>
          ◀
        </button>
        <button className="btn primary" aria-label={playing ? 'Pause' : 'Play'} aria-pressed={playing} onClick={() => setPlaying(!playing)}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="btn" aria-label="Step forward" title={`Forward one ${step}`} onClick={() => setOrd(ord + inc)}>
          ▶|
        </button>
        <button className="btn" aria-label="Jump to latest" title="Jump to latest" onClick={() => setOrd(maxOrd)}>
          ⏭
        </button>
        <label className="tl-field">
          <span>Date</span>
          <input type="date" value={iso} min={ordToIso(minOrd)} max={ordToIso(maxOrd)} onChange={(e) => e.target.value && setOrd(isoToOrd(e.target.value))} aria-label="Selected date" />
        </label>
        <label className="tl-field">
          <span>Step</span>
          <select value={step} onChange={(e) => setStep(e.target.value as Step)} aria-label="Playback step">
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </label>
        <label className="tl-field">
          <span>Speed</span>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
            {[1, 2, 4, 8, 16].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <label className="tl-field">
          <span>Compare with</span>
          <input
            type="date"
            value={compareOrd != null ? ordToIso(compareOrd) : ''}
            min={ordToIso(minOrd)}
            max={ordToIso(maxOrd)}
            onChange={(e) => setCompareOrd(e.target.value ? isoToOrd(e.target.value) : null)}
            aria-label="Comparison date (before/after)"
          />
          {compareOrd != null && (
            <button className="btn tiny" onClick={() => setCompareOrd(null)} aria-label="Clear comparison">
              ✕
            </button>
          )}
        </label>
        {reducedMotion && <span className="muted small">reduced motion</span>}
      </div>
      <input
        className="tl-slider"
        type="range"
        min={minOrd}
        max={maxOrd}
        value={ord}
        onChange={(e) => setOrd(Number(e.target.value))}
        aria-label="Timeline position"
        aria-valuetext={iso}
      />
      <div className="tl-ticks" aria-hidden="true">
        {Array.from({ length: 26 }, (_, i) => 2001 + i).map((y) => (
          <span key={y} style={{ left: `${((isoToOrd(`${y}-01-01`) - minOrd) / (maxOrd - minOrd)) * 100}%` }}>
            {y % 5 === 0 ? y : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
