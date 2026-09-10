/**
 * Public-web discovery for one person: emails, booking links, social handles.
 *
 * Sources, in order of trust:
 *   1. Pages we were pointed at (personal site, org team page, LinkedIn "about" is not fetchable).
 *   2. GitHub profile API (public email if the person set one).
 *   3. Pages linked from the personal site (about, contact, team).
 */
import { asciiToken, domainFromUrl } from "./permute.ts";

export interface Discovery {
  emails: { email: string; url: string }[];
  booking: string[];
  links: { site: string; linkedin: string; twitter: string; github: string };
  pagesFetched: string[];
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const OBFUSCATED_RE =
  /([a-zA-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\{at\}|\s+at\s+)\s*([a-zA-Z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\{dot\}|\s+dot\s+)\s*([a-zA-Z]{2,})/gi;
const BOOKING_RE = /https?:\/\/(?:[a-z0-9-]+\.)?(?:calendly\.com|cal\.com|savvycal\.com|zcal\.co|tidycal\.com|meetings\.hubspot\.com|calendar\.app\.google|calendar\.google\.com\/calendar\/appointments)[^\s"'<>)\]]*/gi;

const IGNORED_EMAIL_HOSTS = [
  "example.com",
  "sentry.io",
  "wixpress.com",
  "w3.org",
  "schema.org",
  "domain.com",
  "email.com",
  "yoursite.com",
];

const USER_AGENT = "Mozilla/5.0 (compatible; outreach-discovery/1.0; +https://github.com/LeiaAnapaula/souling-lite)";

export async function fetchText(url: string, timeoutMs = 10000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
      redirect: "follow",
    });
    if (!res.ok) return "";
    const type = res.headers.get("content-type") ?? "";
    if (!/text|json|xml/.test(type)) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

export function extractEmails(html: string): string[] {
  const found = new Set<string>();
  // Decode the most common HTML entities and percent-encoding used in mailto links.
  const text = html
    .replace(/&#64;|&commat;|%40/g, "@")
    .replace(/&#46;/g, ".")
    .replace(/&nbsp;/g, " ");
  for (const m of text.match(EMAIL_RE) ?? []) {
    const e = m.toLowerCase().replace(/^mailto:/, "");
    // Skip images and hashed asset names that happen to look like addresses.
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(e)) continue;
    if (IGNORED_EMAIL_HOSTS.some((h) => e.endsWith("@" + h))) continue;
    if (/^[0-9a-f]{8,}@/.test(e)) continue;
    found.add(e);
  }
  for (const m of text.matchAll(OBFUSCATED_RE)) {
    found.add(`${m[1]}@${m[2]}.${m[3]}`.toLowerCase());
  }
  return [...found];
}

export function extractBookingLinks(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.match(BOOKING_RE) ?? []) out.add(m.replace(/[.,;]+$/, ""));
  return [...out];
}

export function extractSocial(html: string): Partial<Discovery["links"]> {
  const out: Partial<Discovery["links"]> = {};
  const li = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_%-]+/);
  if (li) out.linkedin = li[0];
  const tw = html.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!share|intent|home|search)[a-zA-Z0-9_]{2,15}\b/);
  if (tw) out.twitter = tw[0];
  const gh = html.match(/https?:\/\/(?:www\.)?github\.com\/(?!login|about|features|pricing|topics|orgs)[a-zA-Z0-9-]{2,39}\b/);
  if (gh) out.github = gh[0];
  return out;
}

/** GitHub exposes a public email on the profile when the user opts in. */
export async function githubProfile(login: string): Promise<{ email: string; blog: string; twitter: string }> {
  const raw = await fetchText(`https://api.github.com/users/${encodeURIComponent(login)}`);
  if (!raw) return { email: "", blog: "", twitter: "" };
  try {
    const j = JSON.parse(raw) as { email?: string | null; blog?: string | null; twitter_username?: string | null };
    return {
      email: j.email ?? "",
      blog: j.blog ?? "",
      twitter: j.twitter_username ? `https://x.com/${j.twitter_username}` : "",
    };
  } catch {
    return { email: "", blog: "", twitter: "" };
  }
}

/** Pages on a site that usually carry contact info. */
function contactPaths(site: string): string[] {
  const base = site.replace(/\/+$/, "");
  return [base, `${base}/about`, `${base}/contact`, `${base}/team`, `${base}/people`, `${base}/press`];
}

/** Does this address plausibly belong to the person (or to a generic inbox at their org)? */
export function emailBelongsTo(email: string, first: string, last: string): "person" | "generic" | "other" {
  const local = email.split("@")[0].toLowerCase();
  const f = asciiToken(first);
  const l = asciiToken(last);
  if ((f && local.includes(f)) || (l && l.length > 2 && local.includes(l))) return "person";
  if ((f && local.startsWith(f[0]) && l && local.includes(l)) || (l && local.startsWith(l[0]) && f && local.includes(f))) return "person";
  if (/^(hello|hi|info|contact|press|media|team|office|assistant|ea|admin|founders?|pr|partnerships)$/.test(local)) return "generic";
  return "other";
}

export interface DiscoverInput {
  first: string;
  last: string;
  site?: string;
  domain?: string;
  github?: string;
  extraUrls?: string[];
}

export async function discoverPerson(input: DiscoverInput): Promise<Discovery> {
  const result: Discovery = {
    emails: [],
    booking: [],
    links: { site: input.site ?? "", linkedin: "", twitter: "", github: input.github ?? "" },
    pagesFetched: [],
  };
  const urls = new Set<string>();
  if (input.site) contactPaths(input.site.includes("://") ? input.site : `https://${input.site}`).forEach((u) => urls.add(u));
  if (input.domain && domainFromUrl(input.domain) && !input.site) {
    contactPaths(`https://${domainFromUrl(input.domain)}`).slice(0, 4).forEach((u) => urls.add(u));
  }
  for (const u of input.extraUrls ?? []) urls.add(u);

  const seenEmails = new Set<string>();
  for (const url of urls) {
    const html = await fetchText(url);
    if (!html) continue;
    result.pagesFetched.push(url);
    for (const e of extractEmails(html)) {
      const kind = emailBelongsTo(e, input.first, input.last);
      if (kind === "other") continue;
      if (seenEmails.has(e)) continue;
      seenEmails.add(e);
      result.emails.push({ email: e, url });
    }
    for (const b of extractBookingLinks(html)) if (!result.booking.includes(b)) result.booking.push(b);
    const social = extractSocial(html);
    if (social.linkedin && !result.links.linkedin) result.links.linkedin = social.linkedin;
    if (social.twitter && !result.links.twitter) result.links.twitter = social.twitter;
    if (social.github && !result.links.github) result.links.github = social.github;
  }

  const ghLogin = result.links.github.match(/github\.com\/([a-zA-Z0-9-]+)/)?.[1];
  if (ghLogin) {
    const gh = await githubProfile(ghLogin);
    if (gh.email && !seenEmails.has(gh.email.toLowerCase())) {
      result.emails.push({ email: gh.email.toLowerCase(), url: `https://github.com/${ghLogin}` });
    }
    if (gh.blog && !result.links.site) result.links.site = gh.blog;
    if (gh.twitter && !result.links.twitter) result.links.twitter = gh.twitter;
  }
  // Person-specific addresses first, generic inboxes after.
  result.emails.sort((a, b) => {
    const ka = emailBelongsTo(a.email, input.first, input.last) === "person" ? 0 : 1;
    const kb = emailBelongsTo(b.email, input.first, input.last) === "person" ? 0 : 1;
    return ka - kb;
  });
  return result;
}
