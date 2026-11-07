import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM build script
import { sharePageHtml } from '../scripts/share-page.mjs'

const story = {
  id: 'onion-2023-02-gap-lasalgaon-azadpur', title: 'The onion trade that looked "profitable" <but> wasn\'t', period: '2023-02',
  summary: 'Lasalgaon → Azadpur, February 2023: a ₹358 gap & more.',
}

describe('static share page', () => {
  const html = sharePageHtml(story, 'https://amritesh.github.io/agrinet/')
  it('has escaped, story-specific Open Graph tags and an absolute preview image', () => {
    expect(html).toContain('<meta property="og:title" content="The onion trade that looked &quot;profitable&quot; &lt;but&gt; wasn&#39;t · February 2023">')
    expect(html).toContain('content="https://amritesh.github.io/agrinet/s/onion-2023-02-gap-lasalgaon-azadpur/og.png"')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(html).toContain('₹358 gap &amp; more')
    expect(html).toContain('<link rel="canonical" href="https://amritesh.github.io/agrinet/s/onion-2023-02-gap-lasalgaon-azadpur/">')
    expect(html).not.toContain('<but>')
  })
  it('labels the story as historical and modeled, and forwards to the app story', () => {
    expect(html).toMatch(/Historical data, not live prices/)
    expect(html).toContain('href="https://amritesh.github.io/agrinet/?story=onion-2023-02-gap-lasalgaon-azadpur"')
    expect(html).toContain('location.replace("https://amritesh.github.io/agrinet/?story=onion-2023-02-gap-lasalgaon-azadpur")')
  })
  it('rejects ids that could escape the share directory', () => {
    expect(() => sharePageHtml({ ...story, id: '../x' }, 'https://a/')).toThrow()
  })
})
