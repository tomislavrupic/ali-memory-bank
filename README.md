# ALi / Memory Bank

A private browser archive of early QATC and ALi conversations. Search original messages, browse chronologically, open surrounding context, and download a conversation with its source references.

Website: https://tomislavrupic.github.io/ali-memory-bank/

## Sign in

Click **Sign in with Cloudflare** and complete your Cloudflare login in the window that opens. Access is restricted to the owner email in the Cloudflare Access policy and verified again by the API. Tokens are held in browser memory and disappear when the tab closes. Reloading the page requires sign-in again; Cloudflare may reuse its existing login session.

Search requires all entered words, ignores case and accents, and searches original message content. Timeline orders results by the conversation's creation date. Topic counts indicate conversations containing the named term; they do not certify the contents of a historical discussion. The default collection shows conversations mentioning QATC, ALi, HAT, HAOS, Source Cube, Abzu or ULUF. The full archive is also available.

Source messages retain their text, role, message ID, order, timestamp and parent ID. The reader shows a chronological slice of the imported trace, including exported branches where present; it does not infer a single active conversation branch. Use **Earlier / Later** to browse further. The local export and trace files remain the original record.

## Hosting and privacy

GitHub Pages hosts only the React app. A Cloudflare Worker validates Cloudflare Access RS256 JWT signatures, issuer, audience, expiry and owner email before reading D1. The private D1 database is restricted to EU storage. No conversation files, database dumps, login tokens, analytics or external fonts are included in the public site.

Cloudflare Access protects `/auth/*`. The login bridge uses a fixed website destination and a random request state, returns the verified token through `postMessage`, and falls back to a URL fragment only when no opener is available. The app clears that fragment immediately. API routes independently validate bearer tokens; CORS alone is not authorization. Session expiry locks the app. Sign out clears the app's credentials; the separate Cloudflare account login can remain active.

## Development

Requires Node.js 22.13+ (tests use `node:sqlite`).

```sh
npm ci
npm test
npm run build
npm run dev
```

The production login bridge only returns to the configured `APP_URL`. A local browser preview displays the sign-in screen, but authenticated local development needs a separate Access application, Worker and `APP_URL`. Do not weaken production CORS or authorization for local testing.

## Refreshing the private archive

Run from this checkout, on the machine holding the original trace sessions:

```sh
npm run prepare:archive -- "/absolute/path/to/memory/traces/chatgpt_export"
npx wrangler d1 execute ali-memory-bank --remote --file .private/archive.sql --yes
node scripts/verify-archive.mjs "/absolute/path/to/memory/traces/chatgpt_export"
```

Preparation writes an ignored `.private/archive.sql`. Imports preserve existing rows, split oversized statements without truncation, and rebuild the full-text index. Existing session metadata is not replaced. If an existing source message has changed, reconcile it explicitly before importing; the importer is intended for immutable traces and new sessions. D1's bulk import temporarily makes the database unavailable and rolls back a failed import.

The default source is the sibling `ali-genesis/memory/traces/chatgpt_export` folder. Neither that folder nor `.private/` belongs in Git. The verification script compares archive counts, UTF-8 byte totals and SHA-256 checksums for the five largest and ten distributed source messages.

## Deployments

The Pages workflow tests and builds on pushes to `main`. Worker deployments are separate:

```sh
npm test
npx wrangler deploy --dry-run
npm run worker:deploy
```

`wrangler.jsonc` identifies the dedicated Worker, D1 database and Access audience. It contains configuration, not API credentials. Authenticate Wrangler locally; never add its credentials to this repository. Existing unrelated Cloudflare applications and repositories are not used for archive storage.

## Checks

Tests cover private-route denial before data access, JWT signature/account/audience/expiry checks, CORS, login destination/state handling, full-text matching, pagination, source reconstruction, and oversized Unicode message import with safe retries. Browser fixture checks are separate from live Cloudflare login acceptance, which requires the owner's interactive sign-in.
