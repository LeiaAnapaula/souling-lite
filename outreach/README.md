# Outreach

Find the right people, find their email, write one true sentence, send, follow up, stop the moment they reply. Runs locally, state lives in one SQLite file, nothing is sent until you flip the provider.

```
research  ->  discover  ->  hooks  ->  enroll  ->  run (repeat daily)
 who?         email?      opener     sequence    send + follow up + stop on reply
```

## Setup

```bash
npm install
npm run outreach -- init          # creates outreach/config.json
```

Edit `outreach/config.json`: `sender.name`, `sender.email`, `sender.about` (one line about you, used in emails and personalization prompts), `sender.booking` (your cal.com or Calendly link). Leave `provider` on `dry-run` until previews look right.

Credentials go in `outreach/.env` (git-ignored):

```
ANTHROPIC_API_KEY=...            # research + hooks
# Gmail provider (recommended: replies and bounces are detected automatically)
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
# or Resend
RESEND_API_KEY=...
```

Gmail OAuth: create a Desktop OAuth client in Google Cloud Console, enable the Gmail API, run the OAuth Playground once with scopes `https://www.googleapis.com/auth/gmail.send` and `https://www.googleapis.com/auth/gmail.readonly` using your own client id and secret, and paste the refresh token. Send from a real mailbox you read every day. Do not send cold email from a brand-new domain.

## Build a list

Any group you can describe in a sentence:

```bash
npm run outreach -- research "female billionaires on the 2026 Forbes list who founded their company" --list forbes-women --max 40
npm run outreach -- research "the investors on Shark Tank" --list sharks
npm run outreach -- research "all 2026 Thiel Fellows" --list thiel-2026
npm run outreach -- research "Peter Thiel and the people who run his inbox" --list thiel
npm run outreach -- research "engineering leaders at Anthropic" --list anthropic-eng
```

Claude searches the web, finds each person's organization and its domain, personal site, LinkedIn, X, GitHub, any public booking link, any publicly listed email, who gatekeeps their inbox, and two to four specific recent facts for personalization. Nothing is guessed at this stage.

Or import a CSV with columns `name, org, title, domain, email, site, linkedin, twitter, github, booking, notes` (only `name` is required):

```bash
npm run outreach -- import people.csv --list sharks
```

## Find addresses

```bash
npm run outreach -- discover --list sharks            # scrape + permute
npm run outreach -- discover --list sharks --verify   # also SMTP-check
```

For each person, in order:

1. **Public pages.** Personal site, its `/about`, `/contact`, `/team`, the org site's contact pages, and the GitHub profile API. Finds `mailto:` links, plain and obfuscated addresses (`name [at] site [dot] com`), Calendly / cal.com / SavvyCal links, and social profiles.
2. **Org pattern learning.** If anyone else in your database has a confirmed address on the same domain, the pattern they follow (`first.last`, `flast`, ...) is detected and ranked first for everyone else at that org.
3. **Permutations.** Fourteen common formats, ranked. Accents and hyphens are normalized, honorifics and suffixes stripped.
4. **SMTP verification** (`--verify` or `verify`). Asks the mail server whether the mailbox exists without sending anything. Detects catch-all domains so a "yes" is not mistaken for proof. Port 25 is blocked on most laptops and cloud sandboxes, so this often reports `unknown`; the ranking still stands.
5. **Choice.** Found on a public page beats verified beats best guess. `requireVerifiedOrFound: true` in config disables sending to bare guesses entirely.

If a guessed address bounces, the next candidate is tried automatically and the first email is re-sent to it. After `maxGuessAttempts` bounces the person is marked `bounced` and left alone. Keep this at 2: a bounce rate above a few percent damages your domain's deliverability for every email you send afterward.

A public booking link changes the play: when `booking` is found, consider booking directly instead of emailing. `export --list` shows it.

## Write

```bash
npm run outreach -- hooks --list sharks        # Claude writes one specific opening sentence per person from the research notes
npm run outreach -- preview --id 12            # every step, rendered, for one person
```

Templates live in `outreach/templates/<name>.json`. Variables: `{{first}}`, `{{last}}`, `{{full_name}}`, `{{org}}`, `{{title}}`, `{{hook}}`, `{{sender.name}}`, `{{sender.first}}`, `{{sender.about}}`, `{{sender.booking}}`. A line whose only variable is empty disappears, so a person with no hook gets a clean template. Follow-ups without a `subject` reply in the same thread as `Re: <first subject>`.

The opt-out line and your address from config are appended to every email. Replies containing "no thanks", "unsubscribe", "not interested" and similar stop the sequence and suppress the address permanently.

## Send and follow up

```bash
npm run outreach -- enroll --list sharks --sequence default
npm run outreach -- run                      # send everything due, inside the window, under the cap
npm run outreach -- status
```

`run` first checks the inbox (Gmail provider): any reply stops that person's sequence, bounces roll to the next address. Then it sends whatever is due, respecting `sendWindow`, `weekdaysOnly`, `dailyCap` (rolling 24h) and `minSecondsBetweenSends`. Follow-ups are scheduled from the previous send plus `delayDays`, with jitter, snapped to the next open window.

Schedule it hourly and forget it:

```
# crontab -e
0 * * * * cd /path/to/souling-lite && npm run -s outreach -- run >> outreach/data/run.log 2>&1
```

Anything that isn't Gmail: mark replies by hand with `mark-replied --id N` and bounces with `mark-bounced --id N`.

## Manage

```
show --id N              full record, candidates, messages, events
list --list L            one line per person
export --list L          CSV
set-email --id N a@b.com
pause / resume --id N
unsubscribe a@b.com      permanent suppression
```

## Ground rules baked in

- One person, one address at a time. Never blast every permutation.
- Every email carries a plain-language opt-out and your location.
- A reply, any reply, ends the sequence.
- Caps and hours are on by default. Raise them on purpose, not by accident.
- Only publicly available sources are read. No login-walled scraping, no purchased lists.

## Layout

```
outreach/
  cli.ts              commands
  lib/db.ts           SQLite store (node:sqlite, no native deps)
  lib/permute.ts      name parsing, patterns, pattern learning
  lib/discover.ts     public page scraping, booking links, GitHub profile
  lib/dns.ts          MX lookup, SMTP RCPT verification, catch-all detection
  lib/claude.ts       research agent (web search) and one-line personalization
  lib/render.ts       templates
  lib/sequence.ts     scheduling, bounce and reply handling
  lib/send.ts         providers: dry-run, resend, gmail
  lib/gmail.ts        Gmail REST client
  lib/replies.ts      inbox scan
  templates/          sequences
  tests/              node:test unit tests
  data/               sqlite + dry-run outbox (git-ignored)
```

```bash
npm run outreach:test
npm run outreach:typecheck
```

Requires Node 22.13 or newer (runs TypeScript directly, uses the built-in SQLite).
