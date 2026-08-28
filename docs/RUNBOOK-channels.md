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

2. Whitelist the domain in the Lua dashboard under **Chat Widget → Customization**. For localhost,
   set `environment: "production"` in the `LuaPop.init` call to bypass domain validation.
3. Serve it: `npx serve portal`, or push it to GitHub Pages for a shareable link.

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
