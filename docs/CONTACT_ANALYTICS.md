# Contact section and website analytics

Scope: a collaboration section, cookieless visitor analytics and public metadata. No change to data pipelines, Supabase, shocks, optimization or the map.

## Configuration (all optional, owner-approved public values only)

Set as GitHub **repository Variables** (Settings → Secrets and variables → Actions → Variables). The deploy workflow passes them to the build; an empty value turns the feature off.

| Variable | Used for | When unset |
|---|---|---|
| `PUBLIC_CONTACT_EMAIL` | `mailto:` links with subject `AGRINET — <category>` | Contact buttons open a public GitHub issue; page warns not to post private info |
| `PUBLIC_LINKEDIN_URL` | LinkedIn link (must be `https://*.linkedin.com/...`) | Link hidden |
| `CF_WEB_ANALYTICS_TOKEN` | Cloudflare Web Analytics site token (public, appears in page source) | No beacon is loaded |

`PUBLIC_GITHUB_URL` is fixed to `https://github.com/Amritesh/agrinet`. The code reads no other keys; it never derives contact details from git config or accounts (tested in `web/tests/contact.test.ts`). Invalid values are dropped, not published.

## Collaboration section
- Workspace bar → **Collaborate** (compact, right-aligned on desktop); deep link `#collaborate`; subtle footer link on non-map workspaces.
- Six categories, each with a "Start a conversation" link. Status block separates **available now** from **in development** and states the prototype has no live prices, customers, revenue or backing.
- No form, no popup, no chat widget, nothing floating over the map.

## Analytics: Cloudflare Web Analytics
Installed per https://developers.cloudflare.com/web-analytics/get-started/ (manual JS beacon, works for GitHub Pages). `web/src/lib/webAnalytics.ts` injects `https://static.cloudflareinsights.com/beacon.min.js` once, from `main.tsx` outside React (StrictMode cannot double-register).

**Pageview policy:** one pageview per genuine document load. `"spa": false` is set deliberately: AGRINET rewrites the URL with `history.replaceState` on every commodity/date/market change and while the time machine plays, so automatic SPA tracking could count timeline movement as page views. Workspace switches do not change the URL and are not counted. Trade-off: in-app navigation is undercounted by design.

**Privacy:** Cloudflare Web Analytics is cookieless and does not fingerprint. The beacon reports the page URL, so loads carrying a scenario share link (`?s=`, user-entered commercial inputs) are not measured at all. No custom events: Cloudflare Web Analytics has no custom-event API, so CTA/link clicks are **not** tracked, and no second analytics tool was added. There is no public visitor counter; data is visible only in the Cloudflare dashboard.

**Metric definitions** (Cloudflare's own; AGRINET computes nothing):
- *Page views*: successful HTML page loads reported by the beacon.
- *Visits*: page views whose HTTP referrer does not match the hostname (arrival from another site or a direct link); one visit can include several page views. Cloudflare's high-level metrics do not include a unique-visitor or session count, so AGRINET reports neither.
- Dimensions available in the dashboard: country, referrer (host/path), device type, browser, OS, path; Core Web Vitals / page-load timings; time series by day/week.

**Failure handling:** blocked or failing beacon removes its own script tag; app rendering never depends on it (tested with the beacon aborted).

## Activation steps (owner)
1. Cloudflare dashboard → Web Analytics → Add a site → hostname `amritesh.github.io` (no DNS change needed for the JS beacon; free). Copy the site token from the snippet.
2. Add repository variable `CF_WEB_ANALYTICS_TOKEN`, then re-run the Deploy workflow.
3. Verify: page source contains `data-cf-beacon`; network tab shows `cloudflareinsights.com/cdn-cgi/rum` request; the dashboard shows the visit after a few minutes. Only then claim analytics is live.
4. Optionally add `PUBLIC_CONTACT_EMAIL` / `PUBLIC_LINKEDIN_URL` and redeploy.

## Metadata
Title, description, canonical, Open Graph and Twitter card in `web/index.html`. Preview image `web/public/og-image.png` (1200×630) is a real screenshot of the atlas (onion, 16 Jan 2024), not a mock.
