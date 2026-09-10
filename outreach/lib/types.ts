export type ContactStatus =
  | "new" // imported, nothing discovered yet
  | "discovered" // discovery ran, may or may not have an email
  | "ready" // has a chosen email, not yet enrolled
  | "active" // enrolled in a sequence, sends pending
  | "replied"
  | "bounced" // all candidates exhausted
  | "unsubscribed"
  | "done" // sequence finished without reply
  | "paused";

export type EmailStatus =
  | "unknown"
  | "found" // scraped from a public page or profile
  | "guessed" // generated from a name pattern
  | "verified" // SMTP said the mailbox exists
  | "catchall" // domain accepts everything, cannot verify
  | "bounced";

export type CandidateStatus = "untested" | "valid" | "invalid" | "catchall" | "unknown" | "bounced";

export interface Contact {
  id: number;
  list: string;
  first: string;
  last: string;
  fullName: string;
  org: string;
  title: string;
  domain: string;
  email: string;
  emailStatus: EmailStatus;
  status: ContactStatus;
  site: string;
  linkedin: string;
  twitter: string;
  github: string;
  booking: string; // calendly / cal.com / savvycal link
  notes: string; // research notes used for personalization
  hook: string; // generated personal opening line
  sequence: string;
  step: number; // number of steps already sent
  nextSendAt: string; // ISO timestamp or ""
  threadId: string;
  lastMessageId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Candidate {
  id: number;
  contactId: number;
  email: string;
  source: string; // "found:<url>" | "pattern:first.last" | "github" ...
  score: number;
  status: CandidateStatus;
}

export interface OutboundMessage {
  id: number;
  contactId: number;
  step: number;
  toEmail: string;
  subject: string;
  body: string;
  provider: string;
  providerId: string;
  threadId: string;
  messageId: string;
  sentAt: string;
}

export interface SequenceStep {
  /** Days after the previous step. Step 0 is sent immediately when due. */
  delayDays: number;
  /** Subject; follow-ups without a subject reuse the thread subject. */
  subject?: string;
  body: string;
}

export interface Sequence {
  name: string;
  steps: SequenceStep[];
}

export interface Sender {
  name: string;
  email: string;
  /** One line about who you are, used in personalization prompts. */
  about: string;
  /** Postal address or city for the footer. Optional for 1:1 mail, required for bulk commercial mail. */
  address?: string;
  /** Your own booking link, offered in emails. */
  booking?: string;
}

export interface Config {
  sender: Sender;
  provider: "dry-run" | "resend" | "gmail";
  /** Max emails sent per `run`. */
  dailyCap: number;
  /** Minimum seconds between two sends in one run. */
  minSecondsBetweenSends: number;
  /** Local hours (24h) inside which sends happen. */
  sendWindow: { start: number; end: number; timezone: string };
  /** Skip weekends. */
  weekdaysOnly: boolean;
  /** How many guessed addresses may be tried per person when the first bounces. */
  maxGuessAttempts: number;
  /** Only send to addresses that were found or SMTP-verified, never to a bare guess. */
  requireVerifiedOrFound: boolean;
  /** Claude model for research and personalization. */
  model: string;
  /** Append an opt-out line to every email. */
  optOutLine: string;
}

export const DEFAULT_CONFIG: Config = {
  sender: { name: "", email: "", about: "" },
  provider: "dry-run",
  dailyCap: 40,
  minSecondsBetweenSends: 45,
  sendWindow: { start: 8, end: 18, timezone: "America/Los_Angeles" },
  weekdaysOnly: true,
  maxGuessAttempts: 2,
  requireVerifiedOrFound: false,
  model: "claude-opus-5",
  optOutLine: "If you'd rather not hear from me again, reply with \"no thanks\" and I'll stop.",
};
