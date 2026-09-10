import type { Config, Contact, Sequence, SequenceStep } from "./types.ts";

/** Fill {{first}}, {{org}}, {{hook}}, {{sender.name}} ... placeholders. */
export function render(template: string, contact: Contact, cfg: Config): string {
  const vars: Record<string, string> = {
    first: contact.first ? capitalize(contact.first) : contact.fullName.split(" ")[0] ?? "",
    last: capitalize(contact.last),
    full_name: contact.fullName,
    org: contact.org,
    title: contact.title,
    hook: contact.hook,
    "sender.name": cfg.sender.name,
    "sender.first": cfg.sender.name.split(" ")[0] ?? "",
    "sender.about": cfg.sender.about,
    "sender.booking": cfg.sender.booking ?? "",
  };
  let out = template.replace(/\{\{\s*([a-zA-Z_.]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
  // Drop lines that became empty because their only variable was blank (e.g. no hook).
  out = out
    .split("\n")
    .filter((line, i, arr) => !(line.trim() === "" && arr[i - 1]?.trim() === ""))
    .join("\n");
  return out.trim();
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

export interface RenderedEmail {
  subject: string;
  body: string;
}

export function renderStep(seq: Sequence, stepIndex: number, contact: Contact, cfg: Config, threadSubject: string): RenderedEmail {
  const step: SequenceStep = seq.steps[stepIndex];
  const firstSubject = render(seq.steps[0].subject ?? "", contact, cfg);
  let subject = step.subject ? render(step.subject, contact, cfg) : threadSubject || firstSubject;
  if (stepIndex > 0 && !step.subject && !/^re:/i.test(subject)) subject = `Re: ${subject}`;
  let body = render(step.body, contact, cfg);
  const footer: string[] = [];
  if (cfg.optOutLine) footer.push(cfg.optOutLine);
  if (cfg.sender.address) footer.push(cfg.sender.address);
  if (footer.length) body = `${body}\n\n${footer.join("\n")}`;
  return { subject, body };
}
