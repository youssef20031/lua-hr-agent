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

### The embedded widget does not currently connect — checked 29 August 2026

The LuaPop bubble needs a webchat configuration registered against the agent, and there is no way to
create one. **Connect a channel** offers Facebook, WhatsApp, Instagram, Slack, Email, MessageBird,
Front, Phone, Meetings, Microsoft Teams and iMessage — searching it for `web`, `site` and `widget`
returns nothing. There is no "Chat Widget" section anywhere in the dashboard; an earlier version of
this runbook said to whitelist the domain under **Chat Widget → Customization**, and that section no
longer exists.

What `GET /webchat/config` returns tells you where the boundary is:

| `website=` | Response | Meaning |
| --- | --- | --- |
| `localhost` | `400` | Rejected as an invalid website value, whatever else is configured |
| `youssef20031.github.io` | `404` | Valid domain, but no webchat config exists for this agent |

Either way `POST /chat/welcome/{agentId}` then returns `401`, because there is nothing to authorise
against. The `environment: "production"` flag that this runbook used to recommend as a localhost
bypass changes neither response — the request still carries `website=localhost` and still fails. The
page keeps that flag scoped to localhost only, so a real host enforces whatever allow-list exists
rather than silently skipping it.

The portal handles this: the widget failure is caught and the page falls back to
"Chat could not open. Use WhatsApp instead.", which is a working channel rather than a dead end.
Office staff on the portal reach the same agent through the WhatsApp door until the widget can be
configured.

The page keeps both languages on screen at once and the toggle changes reading direction rather than
hiding a language, which is how bilingual signage on a Saudi industrial site actually works. Language
choice persists in `localStorage` and falls back to the browser's own preference.

### Subresource integrity

The LuaPop script tag deliberately has no `integrity` hash: Lua publishes the widget from an
unversioned URL and updates it in place, so a pinned hash would break the chat on their next release.
The trade-off is a third-party script dependency on Lua's CDN.

To remove that exposure: vendor a known-good `lua-pop.umd.js` into `portal/`, serve it from the same
origin, and add an integrity hash to the local copy. Re-vendor deliberately when you want their
updates.
