# Runbook — BambooHR

## What you need

1. A BambooHR tenant. The API is available to all customers at no extra cost and is **not**
   partner-gated: "We don't restrict access to our API, so anyone can build an integration."
2. An API key. Generate it from your user context menu, or **Settings → Account → API Keys**.
3. The company domain — the subdomain in `https://{domain}.bamboohr.com`, not the whole URL.

```bash
HRIS_MODE=live
BAMBOOHR_COMPANY_DOMAIN=yourcompany
BAMBOOHR_API_KEY=...
```

## Permissions

The API key inherits the permissions of the user who created it. Create it as a dedicated service
user with exactly the access the agent needs: employee directory, the fields listed in
`EMPLOYEE_FIELDS`, time-off requests, and the Iqama expiry custom field. A `403` from the API almost
always means the key's owning user cannot see that employee or that field.

## The Iqama expiry custom field

Custom fields **cannot be created through the API**. Create it in the BambooHR UI first, then point
the agent at it:

```bash
BAMBOOHR_PERMIT_FIELD=customIqamaExpiry
```

Confirm the alias with `GET /meta/fields`.

## Trial accounts — read this before choosing a dev target

- The free trial's length is not stated on any official page, and whether a trial can generate an API
  key is **not documented either way**. One unverified community report says it cannot. Settle it by
  starting a trial and checking whether the "API Keys" menu entry appears.
- BambooHR does offer **Test Accounts** under the Developer Terms of Service (§1.5), limited to two
  per developer. But that clause also says: *"Developer must use Test Accounts manually. Developers
  may not automate use of the Test Accounts."* This project is an automated agent. **Get written
  clarification from BambooHR before pointing it at a Test Account.** That is a licensing question,
  not a technical one.
- `partners.bamboohr.com/test-account` is dead; it redirects to the partner programme overview. The
  Marketplace sandbox is gated on 100+ customers and a SOC 2 / ISO 27001 audit.

Because of all of this, the adapter defaults to fixtures and nothing in the build depends on a live
tenant.

## Behaviour worth knowing

- **Creating a time-off request is `PUT`, not `POST`** — `PUT /employees/{id}/time_off/request`.
- **There are no time-off webhooks.** A decision made inside BambooHR can only be discovered by
  polling. That is what the nightly `leave-audit-sync` job is for.
- **Throttling changes on 14 September 2026.** Rate-limited requests return `503` today and `429`
  after that date; `503` will then mean genuine unavailability only. The client treats both as
  throttling and honours `Retry-After`.
- **No numeric rate limit is published.** The "100 requests per minute" figure circulating in
  third-party guides appears in no BambooHR source.
- **Send credentials pre-emptively.** BambooHR recommends it: waiting for a 401 challenge doubles
  the round trips and burns rate-limit budget on requests that were always going to fail.
- **`GET /time_off/requests` requires `start` and `end`**, and filters on date *overlap*, not
  containment. The adapter defaults to a wide window so its own interface can keep both optional.

## Verifying the connection

Ask the agent, as an HR user:

> check system health

It reports which backend each integration is actually using, so a silent downgrade to fixtures is
visible rather than mistaken for a live connection.
