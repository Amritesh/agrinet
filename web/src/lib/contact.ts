// Public collaboration contact details. Only values explicitly approved by the
// project owner are published, via build-time variables (GitHub repository
// variables PUBLIC_CONTACT_EMAIL / PUBLIC_LINKEDIN_URL -> VITE_*). Nothing is
// inferred from git config, accounts or other environment keys.

export const PUBLIC_GITHUB_URL = 'https://github.com/Amritesh/agrinet'

export const COLLABORATION_CATEGORIES = [
  { id: 'industry', label: 'Agricultural industry partnership', detail: 'Traders, FPOs and processors who can test market evidence against real operations.' },
  { id: 'logistics', label: 'Logistics and freight-data partnership', detail: 'Transporters and freight platforms with lane rates, capacity or truck routing data.' },
  { id: 'pilot', label: 'Procurement and supply-chain pilot', detail: 'A bounded corridor pilot comparing modeled landed cost with actual outcomes.' },
  { id: 'research', label: 'Research collaboration', detail: 'Price formation, market integration, shocks and post-harvest loss.' },
  { id: 'build', label: 'Co-founder or engineering collaboration', detail: 'Geospatial, data engineering, optimization and product design.' },
  { id: 'invest', label: 'Investor or incubator discussion', detail: 'Early-stage conversations. AGRINET is a research prototype with no revenue or customers.' },
] as const

export type ContactConfig = { email: string | null; linkedinUrl: string | null; githubUrl: string }

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

function approvedEmail(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return EMAIL.test(s) ? s : null
}

function approvedLinkedIn(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  try {
    const u = new URL(s)
    const hostOk = u.hostname === 'linkedin.com' || u.hostname.endsWith('.linkedin.com')
    return u.protocol === 'https:' && hostOk && !u.username && !u.password ? u.toString() : null
  } catch { return null }
}

export function resolveContactConfig(env: Record<string, unknown>): ContactConfig {
  return {
    email: approvedEmail(env.VITE_PUBLIC_CONTACT_EMAIL),
    linkedinUrl: approvedLinkedIn(env.VITE_PUBLIC_LINKEDIN_URL),
    githubUrl: PUBLIC_GITHUB_URL,
  }
}

export function mailtoFor(email: string, category: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(`AGRINET — ${category}`)}`
}

export function issueUrlFor(category: string): string {
  return `${PUBLIC_GITHUB_URL}/issues/new?title=${encodeURIComponent(`Collaboration: ${category}`)}`
}

export const CONTACT = resolveContactConfig(import.meta.env as Record<string, unknown>)
