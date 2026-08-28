# Runbook — Google Sheets (HR Ops control sheet)

## Setup

1. **Create a Google Cloud project** and enable the **Google Sheets API**
   (`console.cloud.google.com/apis/library/sheets.googleapis.com`). Enablement is eventually
   consistent — a request in the first minute can still return `403 SERVICE_DISABLED`.
2. **Create a service account** (IAM & Admin → Service Accounts). Skip the "grant this service
   account access to project" step: IAM roles govern Cloud resources, and a spreadsheet is a Drive
   resource whose ACL is its own sharing list.
3. **Create a JSON key** (Keys → Add key → Create new key → JSON). You cannot download it twice.
4. **Share the spreadsheet** with the service account's `client_email` as **Editor**, and untick
   "Notify people" — the address has no inbox.
5. Base64 the whole key file and set it:

   ```bash
   base64 -w0 key.json                                             # bash
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))  # PowerShell
   ```

   ```bash
   SHEETS_MODE=live
   GOOGLE_SHEETS_ID=<the segment between /d/ and /edit>
   GOOGLE_SERVICE_ACCOUNT_B64=<the base64 blob>
   ```

Use the base64 form. It is the only one where a newline inside the private key cannot be mangled by
a `.env` parser or a hosting dashboard. The client repairs the common `\n` mangling anyway, but not
having the problem is better than handling it.

## Enabling the API does not grant access

This is the mistake almost everyone makes. Enabling the Sheets API authorises **your project** to
call the API. It grants **the service account** nothing on any document. If you get
`403 PERMISSION_DENIED`, in descending order of likelihood:

1. The sheet is not shared with the service account's `client_email`.
2. It is shared as Viewer, but the agent is writing.
3. The token was minted with the read-only scope.
4. A Workspace domain-restricted-sharing policy silently blocked the share — service account domains
   cannot be added as trusted domains. Work around it with a Google Group inside the domain.

A `404` means the id is wrong *or* the sheet is not shared. Check both.

## Tabs

The client creates them on first write, with a frozen header row:

- **SOP Gaps** — questions the knowledge base could not answer
- **Leave Audit** — every leave decision, including ones discovered by the nightly poll
- **Iqama Watchlist** — a *snapshot*, replaced each morning, not an append log

## Why writes use `RAW`

`USER_ENTERED` applies the same parsing as typing into a cell, which corrupts exactly the data an HR
sheet is made of: `01234` becomes `1234`, `+9665...` becomes a number, and anything starting with
`=` becomes a formula. All writes use `RAW`.

## Quotas

300 read and 300 write requests per minute per project, but **60 per minute per user** — and with
one service account, every request is the same user. That 60 is the real ceiling. Batch reads with
`values:batchGet`, which the summary already does.
