import { lazy, Suspense } from 'react'
import { resolveMode } from './lib/stories'
import StoryHome from './components/StoryHome'

// Stories is the default home; heavier workspaces load only when asked for.
const MonthLab = lazy(() => import('./components/MonthLab'))
const App = lazy(() => import('./App'))

export default function Root() {
  const mode = resolveMode(location.search, location.hash)
  if (mode === 'stories') return <StoryHome />
  if (mode === 'lab') return <Suspense fallback={<div style={{ padding: 24 }}>Loading Month Lab…</div>}><MonthLab /></Suspense>
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <App mode={mode} />
    </Suspense>
  )
}
