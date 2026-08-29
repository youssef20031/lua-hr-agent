# Runbook — WhatsApp and the web portal

## WhatsApp, without Meta verification

Fastest path, and what the demo uses. Send this to Lua's shared testing number:

```
link-me-to:<YOUR_AGENT_ID>
```

or open `https://wa.me/13023778932?text=link-me-to:YOUR_AGENT_ID`. Send `unlink-me` to disconnect.

Testing channels have no custom branding, analytics or compliance controls, and the number is shared.
Fine for a demo, not for 50,000 employees.

## WhatsApp in production

You need a Meta Business Account, a WhatsApp Business Account, and a phone number (Meta's free test
number works for development). Then:

```bash
lua channels        # Link new channel -> WhatsApp -> Phone Number ID, WABA ID, Access Token
```

The CLI returns a webhook URL. Paste it into the Meta developer dashboard as the Callback URL and
subscribe to `messages` and `message_status`. The admin dashboard offers Meta's Embedded Signup as
an alternative, which provisions the webhook for you.

### The 24-hour window

Meta only allows free-form messages within 24 hours of the user's last message. Outside it, a send is
queued rather than delivered, or needs a pre-approved template.

This matters here because the Iqama sweep runs at 06:00 and messages people who may not have written
in months. The code handles it: `Channels.send` returns `queued: true`, and both the sweep job and
the leave notifications report that as *deferred*, not delivered. For production, register templates
for the four alert thresholds and send those instead.

## Web portal

`portal/index.html` is a static file with no build step.

1. Set your agent id:

   ```js
   window.RAFIQ_CONFIG = { agentId: 'YOUR_AGENT_ID', whatsappNumber: '13023778932' };
   ```

2. Serve it. `.github/workflows/pages.yml` publishes `portal/` to GitHub Pages on every push that
   touches it, which is the easiest way to get a real HTTPS origin; `npx serve portal` works locally.

### The widget needs its domain whitelisted

Per Lua's own widget guide: **"You must whitelist your domain before the widget will load"** — added
under **Chat Widget → Customization** in the admin dashboard. That section is not part of
**Connect a channel**, which lists only messaging integrations (Facebook, WhatsApp, Instagram,
Slack, Email, MessageBird, Front, Phone, Meetings, Teams, iMessage) and has no web option; searching
it for `web`, `site` or `widget` returns nothing. Look under the agent's own settings instead.

For localhost, passing `environment: "production"` bypasses the domain check. The page does that,
but only when `location.hostname` is a loopback address, so a real host still enforces the
allow-list rather than silently skipping it.

Until the domain is registered, `GET /webchat/config` tells you which half is wrong:

| `website=` | Response | Meaning |
| --- | --- | --- |
| `localhost` | `400` | Rejected as an invalid website value |
| a real origin | `404` | Valid domain, no webchat config registered for this agent |

`POST /chat/welcome/{agentId}` then returns `401`, because there is nothing to authorise against.

### The widget cannot say who the visitor is

This one does not have a workaround. LuaPop's documented options are `agentId`, `environment`,
`position`, `buttonText`, `chatTitle`, `buttonColor`, `buttonIcon`, `welcomeMessage`,
`chatInputPlaceholder`, `displayMode`, `embeddedDisplayConfig`, `targetContainerId`,
`popupButtonStyles` and `sessionId`. **None of them carries a user identity** — no user, email,
phone, external id or token.

`sessionId` is the near miss, and it is worth being precise about why it is not the answer. It
scopes *which conversation* the widget resumes, and the page does set it (below). It is not
identity: the value is client-side, so a visitor can set it to anything, and trusting it would mean
anyone could resume anyone's conversation by guessing an id. Identity still has to be proven, which
is what the one-time code in `account-linking` is for.

So `User.get()` yields no email or phone on the web, `currentEmployee()` resolves to nobody, and
every identity-bound request — balance, submitting leave, gratuity from record — correctly answers
"I could not match you to an employee record". WhatsApp does not have this problem: the sender's
phone number identifies them, which is why the field-worker channel is the one that demonstrates
personal data.

An employee telling the agent "I am Ahmed" does not and should not change this. Identity comes from
the channel, not from a claim inside the conversation, or anyone could read anyone's balance by
asserting a name.

Until Lua exposes an identified-session option, the portal is for what does not need identity —
SOPs, policies, entitlement rules by country — and WhatsApp is for anything personal. That split
happens to match the two audiences in the brief.

### Conversations are scoped to the tab, deliberately

**The transcript is chosen by `localStorage.authToken`, and by nothing else.** The widget mints an
anonymous Firebase user the first time a chat is opened, stores that JWT, and fetches history with
`GET /chat/history/{agentId}` carrying it as the bearer — no session id, no thread id, no date
bound. Origin-scoped storage with no expiry means the token, and the conversation behind it, comes
back next week and for whoever next opens that browser profile. That is the whole of the "chats
from other sessions showing up" and "I have seen this chat yesterday" report.

`sessionId` looks like the answer and is not. It is a real option, and its own JSDoc calls it "the
session ID for resuming a previous session", but `chatApi.fetchChatHistory` and `chatApi.streamChat`
never send it — it stays client-side. Passing it changes nothing a visitor can observe. Verified by
reading the bundle, then confirmed live: clearing `authToken` and reloading produced a different
Firebase `uid` and an empty transcript.

So `portal/index.html` marks the tab with `sessionStorage['rafiq.session']`, and treats the absence
of that marker as "new tab": it removes `authToken` and `lua_pop_session_id` before calling
`LuaPop.init`, which is the last moment before the widget would pick the old identity back up.
Reloads and in-tab navigation keep the marker and the conversation; closing the tab ends both. It
still passes `sessionId`, because it costs nothing and it is the documented way to name a
conversation — but the clearing is what does the work.

A returning visitor loses their history, deliberately. This portal is opened from shared desks and
demo laptops, the widget cannot say who anyone is, and a transcript is not worth handing to the next
person who sits down.

The security half of this lives in the agent, not the page, because a page cannot be trusted to
enforce it: a completed link is stamped with `linkedAt` and `currentEmployee()` ignores a pin older
than `LINK_SESSION_TTL_HOURS` (12), and `unlink_account` ends one on request. Expiry only ignores
the pin — WhatsApp identifies its sender by phone number and falls through to that lookup, so this
can lock nobody out.

### Subresource integrity

The LuaPop script tag deliberately has no `integrity` hash: Lua publishes the widget from an
unversioned URL and updates it in place, so a pinned hash would break the chat on their next release.
The trade-off is a third-party script dependency on Lua's CDN.

To remove that exposure: vendor a known-good `lua-pop.umd.js` into `portal/`, serve it from the same
origin, and add an integrity hash to the local copy. Re-vendor deliberately when you want their
updates.
