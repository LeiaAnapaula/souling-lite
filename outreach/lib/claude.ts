/**
 * Claude-powered pieces: list research (web search) and personalization.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Contact, Sender } from "./types.ts";

let cached: Anthropic | null = null;
export function client(): Anthropic {
  if (!cached) cached = new Anthropic();
  return cached;
}

export interface ResearchedPerson {
  full_name: string;
  org: string;
  title: string;
  domain: string;
  site: string;
  linkedin: string;
  twitter: string;
  github: string;
  booking: string;
  known_email: string;
  gatekeeper: string;
  notes: string;
  source_urls: string[];
}

const PEOPLE_SCHEMA = {
  type: "object",
  properties: {
    people: {
      type: "array",
      items: {
        type: "object",
        properties: {
          full_name: { type: "string" },
          org: { type: "string", description: "Primary company or organization. Empty if none." },
          title: { type: "string" },
          domain: { type: "string", description: "Bare domain of the org's website, e.g. spanx.com. Empty if unknown." },
          site: { type: "string", description: "Personal website URL if any, else empty." },
          linkedin: { type: "string" },
          twitter: { type: "string" },
          github: { type: "string" },
          booking: { type: "string", description: "Public Calendly / cal.com / other booking link if found." },
          known_email: { type: "string", description: "A publicly listed email for this person, else empty. Never guess." },
          gatekeeper: {
            type: "string",
            description: "Name and role of an assistant, chief of staff, or press contact who handles their inbox, if found.",
          },
          notes: {
            type: "string",
            description: "2-4 sentences of specific, recent, verifiable facts useful for a personal opening line.",
          },
          source_urls: { type: "array", items: { type: "string" } },
        },
        required: [
          "full_name",
          "org",
          "title",
          "domain",
          "site",
          "linkedin",
          "twitter",
          "github",
          "booking",
          "known_email",
          "gatekeeper",
          "notes",
          "source_urls",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["people"],
  additionalProperties: false,
} as const;

function textOf(blocks: Anthropic.ContentBlock[]): string {
  return blocks
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Turn a natural-language description of a group into a researched list of people.
 * Two calls: an open web-search pass that gathers notes, then a structured extraction.
 */
export async function researchList(
  description: string,
  opts: { model: string; maxPeople: number; maxSearches?: number; onProgress?: (s: string) => void },
): Promise<ResearchedPerson[]> {
  const c = client();
  const progress = opts.onProgress ?? (() => {});
  const system = `You are a research analyst building a contact list for personal, one-to-one email outreach.
You only report facts you found on the web in this session, with the URL you found them on.
For each person, look for: their primary organization and its website domain, a personal website, LinkedIn, X/Twitter, GitHub,
any public Calendly / cal.com / booking link, any publicly listed email address, and who handles their inbox (assistant, chief of staff, press).
Never invent an email address. If the group is defined by a list (a Forbes list, a fellowship cohort, a TV show cast), find the canonical list first, then research each person.
Stop at ${opts.maxPeople} people. Prefer depth over breadth: a name with an org domain and one specific recent fact beats a bare name.`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Build the list for: "${description}".\n\nWhen you are done searching, write your findings as plain notes, one person per section, including every URL you relied on.`,
    },
  ];
  const tools: Anthropic.ToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches ?? 25 },
  ];

  // Server-tool turns can pause; resume until the model ends its turn.
  let notes = "";
  for (let i = 0; i < 8; i++) {
    progress(`research pass ${i + 1}`);
    const res = await c.messages.stream({
      model: opts.model,
      max_tokens: 32000,
      system,
      tools,
      messages,
    }).finalMessage();
    if (res.stop_reason === "refusal") throw new Error(`Research refused: ${res.stop_details?.explanation ?? ""}`);
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn") continue;
    notes = textOf(res.content);
    break;
  }
  if (!notes.trim()) throw new Error("Research produced no notes");

  progress("extracting structured people");
  const extraction = await c.messages.create({
    model: opts.model,
    max_tokens: 32000,
    system:
      "Extract every person from the notes into the schema. Copy URLs exactly. Leave fields empty when the notes do not state them. Never fabricate an email.",
    messages: [{ role: "user", content: notes }],
    output_config: { format: { type: "json_schema", schema: PEOPLE_SCHEMA } },
  });
  if (extraction.stop_reason === "refusal") throw new Error("Extraction refused");
  const parsed = JSON.parse(textOf(extraction.content)) as { people: ResearchedPerson[] };
  return parsed.people.slice(0, opts.maxPeople);
}

/**
 * Write a one-sentence, specific opening line for a contact from research notes.
 * Returns "" when the notes are too thin to say anything true and specific.
 */
export async function personalHook(contact: Contact, sender: Sender, model: string): Promise<string> {
  if (!contact.notes.trim()) return "";
  const c = client();
  const res = await c.messages.create({
    model,
    max_tokens: 400,
    output_config: { effort: "low" },
    system: `You write the first sentence of a cold email from ${sender.name} (${sender.about}).
Rules: one sentence, under 30 words, plain and warm, references one specific fact from the notes, no flattery adjectives ("amazing", "inspiring"),
no questions, no em dashes, no exclamation marks. If the notes contain nothing specific enough to reference, output exactly: NONE`,
    messages: [
      {
        role: "user",
        content: `Recipient: ${contact.fullName}, ${contact.title} at ${contact.org}.\nNotes:\n${contact.notes}`,
      },
    ],
  });
  if (res.stop_reason === "refusal") return "";
  const text = textOf(res.content).trim();
  return text === "NONE" ? "" : text.replace(/\s+/g, " ");
}
