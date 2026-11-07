import { COLLABORATION_CATEGORIES, CONTACT, issueUrlFor, mailtoFor } from '../lib/contact'
import '../styles/project-contact.css'

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const

export default function ProjectContact() {
  const { email, linkedinUrl, githubUrl } = CONTACT
  const primary = email ? mailtoFor(email, 'Collaboration') : issueUrlFor('General enquiry')
  return (
    <main id="main" className="workspace-page project-contact">
      <div className="eyebrow">COLLABORATE</div>
      <h1>Build the Future of Agricultural Intelligence With Us</h1>
      <p className="workspace-lead">AGRINET is exploring partnerships with agricultural traders, FPOs, logistics providers, food processors, researchers, and early-stage investors.</p>

      <section className="pc-status" aria-label="Project status">
        <div><span className="pc-tag pc-live">Available now</span> Historical market atlas (2001 – 20 Apr 2026), time machine, statistical price shocks, news context, analytics, modeled landed-cost scenarios and road-route inspection.</div>
        <div><span className="pc-tag pc-dev">In development</span> Freight-aware network optimization, comparable grade/variety pricing and verified market locations.</div>
        <p className="pc-note">AGRINET is an independent research prototype. It has no live prices, customers, revenue or institutional backing today.</p>
      </section>

      <ul className="pc-grid" aria-label="Collaboration categories">
        {COLLABORATION_CATEGORIES.map((c) => (
          <li key={c.id} className="pc-card">
            <h2>{c.label}</h2>
            <p>{c.detail}</p>
            <a href={email ? mailtoFor(email, c.label) : issueUrlFor(c.label)} {...(email ? {} : ext)} aria-label={`Start a conversation: ${c.label}`}>Start a conversation →</a>
          </li>
        ))}
      </ul>

      <section className="pc-actions" aria-label="Contact">
        <a className="primary-action" href={primary} {...(email ? {} : ext)}>Contact the project owner</a>
        {linkedinUrl && <a className="pc-link" href={linkedinUrl} {...ext}>LinkedIn</a>}
        <a className="pc-link" href={githubUrl} {...ext}>Project repository on GitHub</a>
      </section>
      <p className="pc-privacy">
        {email ? 'Email opens your own mail app; nothing is collected on this site.' : 'Contact currently opens a public GitHub issue — do not include private information there.'}{' '}
        This site uses cookieless, aggregate Cloudflare Web Analytics when enabled; no forms, cookies or personal profiles.
      </p>
    </main>
  )
}
