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

**Re-checked 28 August 2026.** How you get a tenant at all changed recently, and every third-party
guide on the subject is stale. Quotes below were read on that date from the linked pages.

- **There is no self-serve trial.** `bamboohr.com/signup/` renders a lead-capture form — *"See
  BambooHR in Action"* — asking for work email, job title, company name, phone number and employee
  count, behind a **Get Free Demo** button. It books a sales call. The "no credit card required,
  trial ends automatically" copy elsewhere on that page does not describe this form, and the
  "7-day free trial" figure the review sites repeat appears on no BambooHR page; those sources also
  contradict each other on whether a self-serve trial exists at all. Assume a rep, not a tenant.
- **A demo is not an API key.** Even a successful submission books a call. Nothing on that path
  provisions the tenant and key this adapter needs, so it is not a route to a working
  `HRIS_MODE=live`.
- **Whether a trial tenant can generate an API key is still undocumented.** The
  [API docs](https://documentation.bamboohr.com/docs/getting-started) tie key generation to *user
  permissions*, not to account type, and no BambooHR page states an account-type restriction.
  Third-party aggregators assert one. Unresolved either way.
- **Test Accounts are the real developer route.** The API docs say plainly: *"Create a test BambooHR
  account to develop against"* — but give no link, and the request form is gone (below). The
  [Developer Terms of Service](https://www.bamboohr.com/legal/developer-terms-of-service) caps them
  at *"no more than two (2) BambooHR Test Accounts at any time"*, free, and restricts automation:

  > Developers may not automate use of the Test Accounts, use scripts or bots to generate accounts,
  > users, or data for the purpose of load testing, stress testing, or circumventing usage limits.

  Read the trailing purpose clause carefully. It may qualify the whole list, which would leave an
  agent that reads a directory and files one leave request outside the prohibition — but the terms
  separately require using Test Accounts manually. **This is genuinely ambiguous, and it is a
  licensing question rather than a technical one. Get it in writing before pointing the agent at a
  Test Account.**
- **The whole `partners.bamboohr.com` host is retired**, not just one path. `/developer-sandbox/`
  and `/bamboohr-api-terms-of-use/` both `301` to `bamboohr.com/partner-programs/overview` and
  `bamboohr.com/legal/developer-terms-of-service` respectively. Search engines still index the old
  sandbox URL; it does not resolve. The partner overview page no longer publishes eligibility
  criteria at all — the "100+ customers and a SOC 2 / ISO 27001 audit" gate recorded here previously
  is no longer stated anywhere public.

One email is worth more than the demo form, because it settles both open questions at once:

> I'm evaluating the BambooHR API for an HR assistant integration and would like a developer Test
> Account. The request form at `partners.bamboohr.com/developer-sandbox/` no longer resolves.
> Separately: Developer ToS §1.5 says Test Accounts must be used manually and may not be automated
> "for the purpose of load testing, stress testing, or circumventing usage limits." Does an
> integration that reads the employee directory and files time-off requests at normal interactive
> volume fall inside that restriction?

Because of all of this, the adapter defaults to fixtures and nothing in the build depends on a live
tenant. That is the design working as intended rather than a workaround: `HRIS_MODE=fixture` is a
working implementation, and going live is one environment variable once a tenant exists.

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
