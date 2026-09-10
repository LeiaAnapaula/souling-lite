/**
 * Name handling and email pattern inference.
 *
 * Given "Sara Blakely" + "spanx.com" this produces ranked candidates such as
 * sara@spanx.com, sara.blakely@spanx.com, sblakely@spanx.com ...
 * If we already know one real address on the domain, the pattern it follows
 * is learned and moved to the top of the ranking.
 */

export interface ParsedName {
  first: string;
  last: string;
  middle: string;
}

const HONORIFICS = new Set(["dr", "mr", "mrs", "ms", "miss", "sir", "dame", "prof", "professor"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md", "esq", "mba", "cfa"]);

/** Strip accents and anything that is not a letter, so "José Ñ" becomes "jose n". */
export function asciiToken(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toLowerCase();
}

export function parseName(fullName: string): ParsedName {
  const cleaned = fullName.replace(/\(.*?\)/g, " ").replace(/["“”]/g, " ").replace(/,/g, " ");
  const parts = cleaned
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !HONORIFICS.has(asciiToken(p)))
    .filter((p) => !SUFFIXES.has(asciiToken(p).replace(/\./g, "")));
  if (parts.length === 0) return { first: "", last: "", middle: "" };
  if (parts.length === 1) return { first: asciiToken(parts[0]), last: "", middle: "" };
  // Hyphenated last names keep both halves joined; "de", "van", "von" stick to the surname.
  const particles = new Set(["de", "da", "del", "della", "di", "van", "von", "der", "den", "la", "le", "du", "bin", "al"]);
  let lastStart = parts.length - 1;
  while (lastStart > 1 && particles.has(asciiToken(parts[lastStart - 1]))) lastStart--;
  const first = asciiToken(parts[0]);
  const middle = parts.slice(1, lastStart).map(asciiToken).join(" ");
  const last = parts.slice(lastStart).map(asciiToken).join("");
  return { first, last, middle };
}

export type PatternName =
  | "first"
  | "first.last"
  | "flast"
  | "firstlast"
  | "first_last"
  | "first-last"
  | "last"
  | "f.last"
  | "firstl"
  | "last.first"
  | "lastf"
  | "lfirst"
  | "first.l"
  | "last_first";

/** Default ranking, from a large sample of corporate address formats. */
export const PATTERN_ORDER: PatternName[] = [
  "first",
  "first.last",
  "flast",
  "firstlast",
  "first_last",
  "f.last",
  "firstl",
  "last",
  "first-last",
  "last.first",
  "lastf",
  "first.l",
  "lfirst",
  "last_first",
];

export function applyPattern(p: PatternName, n: ParsedName): string {
  const f = n.first;
  const l = n.last;
  const fi = f.slice(0, 1);
  const li = l.slice(0, 1);
  if (!f) return "";
  switch (p) {
    case "first":
      return f;
    case "last":
      return l;
    case "first.last":
      return l ? `${f}.${l}` : "";
    case "flast":
      return l ? `${fi}${l}` : "";
    case "firstlast":
      return l ? `${f}${l}` : "";
    case "first_last":
      return l ? `${f}_${l}` : "";
    case "first-last":
      return l ? `${f}-${l}` : "";
    case "f.last":
      return l ? `${fi}.${l}` : "";
    case "firstl":
      return l ? `${f}${li}` : "";
    case "first.l":
      return l ? `${f}.${li}` : "";
    case "last.first":
      return l ? `${l}.${f}` : "";
    case "lastf":
      return l ? `${l}${fi}` : "";
    case "lfirst":
      return l ? `${li}${f}` : "";
    case "last_first":
      return l ? `${l}_${f}` : "";
  }
}

/** Given a known real address for a person, work out which pattern it follows. */
export function detectPattern(email: string, name: ParsedName): PatternName | null {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  for (const p of PATTERN_ORDER) {
    if (applyPattern(p, name) === local) return p;
  }
  return null;
}

/** Learn the dominant pattern from several known (name, email) pairs on one domain. */
export function learnPattern(
  known: { first: string; last: string; email: string }[],
): PatternName | null {
  const votes = new Map<PatternName, number>();
  for (const k of known) {
    const p = detectPattern(k.email, { first: asciiToken(k.first), last: asciiToken(k.last), middle: "" });
    if (p) votes.set(p, (votes.get(p) ?? 0) + 1);
  }
  let best: PatternName | null = null;
  let bestVotes = 0;
  for (const [p, v] of votes) {
    if (v > bestVotes) {
      best = p;
      bestVotes = v;
    }
  }
  return best;
}

export interface Permutation {
  email: string;
  pattern: PatternName;
  score: number;
}

/**
 * Produce ranked candidates for a person on a domain.
 * `learned` (a pattern observed on the same domain) goes first with a high score.
 */
export function permutations(name: ParsedName, domain: string, learned: PatternName | null = null): Permutation[] {
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!d || !name.first) return [];
  const out: Permutation[] = [];
  const seen = new Set<string>();
  const order = learned ? [learned, ...PATTERN_ORDER.filter((p) => p !== learned)] : PATTERN_ORDER;
  order.forEach((p, i) => {
    const local = applyPattern(p, name);
    if (!local || seen.has(local)) return;
    // Single-letter locals like "s" are almost never real addresses.
    if (local.length < 2) return;
    seen.add(local);
    const base = learned && p === learned ? 0.95 : Math.max(0.15, 0.7 - i * 0.05);
    out.push({ email: `${local}@${d}`, pattern: p, score: Number(base.toFixed(2)) });
  });
  return out;
}

/** Turn a company or personal website into a bare domain. */
export function domainFromUrl(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Hosts that are never someone's work domain: free mail plus profile/social hosts. */
export const NON_ORG_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "hey.com",
  "github.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "substack.com",
  "medium.com",
  "youtube.com",
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "about.me",
  "linktr.ee",
  "notion.site",
  "wikipedia.org",
  "forbes.com",
]);
