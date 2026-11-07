import { describe, expect, it } from 'vitest'
import { COLLABORATION_CATEGORIES, PUBLIC_GITHUB_URL, resolveContactConfig, mailtoFor, issueUrlFor } from '../src/lib/contact'

describe('public contact configuration', () => {
  it('uses only explicitly approved values and always the public repository', () => {
    const c = resolveContactConfig({ VITE_PUBLIC_CONTACT_EMAIL: 'hello@agrinet.example', VITE_PUBLIC_LINKEDIN_URL: 'https://www.linkedin.com/in/agrinet-example' })
    expect(c.email).toBe('hello@agrinet.example')
    expect(c.linkedinUrl).toBe('https://www.linkedin.com/in/agrinet-example')
    expect(c.githubUrl).toBe('https://github.com/Amritesh/agrinet')
    expect(PUBLIC_GITHUB_URL).toBe('https://github.com/Amritesh/agrinet')
  })

  it('fails safely when details are missing, blank or malformed', () => {
    for (const env of [{}, { VITE_PUBLIC_CONTACT_EMAIL: '  ' }, { VITE_PUBLIC_CONTACT_EMAIL: 'not-an-email', VITE_PUBLIC_LINKEDIN_URL: 'http://linkedin.com/in/x' },
      { VITE_PUBLIC_CONTACT_EMAIL: 'a@b.co?bcc=x@y.z', VITE_PUBLIC_LINKEDIN_URL: 'https://evil.example/linkedin.com' },
      { VITE_PUBLIC_LINKEDIN_URL: 'javascript:alert(1)' }]) {
      const c = resolveContactConfig(env)
      expect(c.email).toBeNull()
      expect(c.linkedinUrl).toBeNull()
      expect(c.githubUrl).toBe(PUBLIC_GITHUB_URL)
    }
  })

  it('never reads non-approved keys such as git or system identities', () => {
    const c = resolveContactConfig({ GIT_AUTHOR_EMAIL: 'private@person.example', USER: 'someone', VITE_SUPABASE_KEY: 'sb_publishable_x' } as Record<string, string>)
    expect(JSON.stringify(c)).not.toMatch(/private@person|someone|sb_publishable/)
  })

  it('lists the six collaboration categories', () => {
    expect(COLLABORATION_CATEGORIES.map((c) => c.label)).toEqual([
      'Agricultural industry partnership', 'Logistics and freight-data partnership', 'Procurement and supply-chain pilot',
      'Research collaboration', 'Co-founder or engineering collaboration', 'Investor or incubator discussion'])
  })

  it('builds an encoded mailto with a helpful subject and no body data', () => {
    const href = mailtoFor('hello@agrinet.example', 'Investor or incubator discussion')
    expect(href).toBe('mailto:hello@agrinet.example?subject=AGRINET%20%E2%80%94%20Investor%20or%20incubator%20discussion')
  })

  it('builds a public GitHub issue link as the fallback action', () => {
    const href = issueUrlFor('Research collaboration')
    expect(href).toBe('https://github.com/Amritesh/agrinet/issues/new?title=Collaboration%3A%20Research%20collaboration')
  })
})
