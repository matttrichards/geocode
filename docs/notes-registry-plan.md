# geo7 / geoloc — Notes: Architecture Plan (v2, serverless-first)

Status: **draft for review** · Owner: Matt
Supersedes the v1 accounts-first draft. Stack: **Cloudflare-native**.

Locked decisions (from review):
- Keep the core product **serverless**; the server powers exactly one capability.
- **Public notes require a reputation system** → persistent identity → accounts.
- **Public notes require GPS-presence at publish** as proof-of-control.
- A **nominal fee** unlocks the public-note feature (Sybil resistance).
- **Pricing: $5 per public code** (one public note per code, one-time per
  location). Private/link notes are always free; multi-audience variants live in
  the private layer.
- **Auto-publish** once GPS + fee pass — **no pre-moderation queue** — but the
  publish UI shows a clear warning that notes are reviewed and abuse / impersonation
  / false info is removed and can ban the account.
- **Moderator: Matt** for v1; evaluating dedicated moderation tooling (Paperclip)
  later.

---

## 0. The principle that makes "server optional" real

Decompose by *which capability actually needs a server*:

- A **private note rides in the link** (`?...&n=...`). The recipient already has it
  in their URL — no lookup, no server. Different audiences = different links
  (backdoor-friend link vs. delivery link), each with its own note.
- A **public note must be looked up _by the code_**, because a code-resolver
  arrives with no note in their URL. That lookup is the *only* server surface.

So the server is genuinely optional: disable/omit the public module (a build/config
flag) and you have the **lite product** — private link-notes + on-device note
manager, fully functional and offline. Turn it on and you add public notes.

| | Private / link note (lite) | Public note (paid) |
|---|---|---|
| Storage | In the URL + on-device manager | Server (D1, code-keyed) |
| Identity | None (implicit trust in link holder) | **Account + reputation** |
| Proof | None needed | **GPS-presence at publish** |
| Cost | Free | **Nominal fee** |
| Backend | None | Cloudflare Functions + D1 |
| Offline | Yes | Read cached; publish needs network |

---

## 1. Why public ⇒ accounts (not capability tokens)

A *capability token* is an unguessable secret link that grants one power by
possession (à la "anyone with the link can edit"). It's the lightest auth, and
it's fine for **private edit-links**. But it has **no persistent identity**, so it
**cannot carry reputation** — and anything public needs accountability that
survives across contributions (track record, rate-limits, ban a bad actor,
let a good one earn auto-publish). Therefore public notes ride on **accounts +
reputation**, not tokens. (Tokens may still be offered as a private convenience.)

---

## 2. Public-note gate (all three required)

To publish/edit a **public** note for a pin:

1. **Account** — persistent identity the reputation attaches to.
2. **GPS-presence at publish** — browser geolocation must fall within tolerance of
   the pin's decoded coordinates (see §5). Proves physical control *now*.
3. **Nominal fee** — Stripe Checkout; raises the cost of mass abuse.

Publishing is **auto-publish** (no pre-moderation queue) once GPS + fee pass; the
publish screen must show a clear notice — *"Public notes are reviewed. Abuse,
impersonation, or false information will be removed and can get your account
banned."* Result is a public note labelled by trust level (§3): GPS gives a
baseline "location-checked" stamp; full "verified occupant" comes with stronger
proof (courier code) in a later phase. Everything is versioned and reportable.

---

## 3. Reputation model (lightweight v1)

Per-account `trust` score drives consequences:

- **New account** → public notes **auto-publish** once GPS+fee pass (shown with the
  "under review" warning); abuse is pulled on report/review and tanks trust → ban.
- **Trust rises** with verified publishes and edits that survive (no upheld reports).
- **Trust falls** with upheld reports / rejected edits; below a floor → **banned**.
- **Established account** → auto-publish, lower friction.

Reputation is the spam/vandalism backstop *for public content*; underneath it,
notes are **append-only revisions** so any bad edit is one revert away (§7).

---

## 4. Auth — minimal, bootstrapped from payment

We need accounts but want to build as little auth as possible for v1:

- **Bootstrap identity from Stripe.** The paid public publish runs through Stripe
  Checkout, which **collects and verifies the payer's email**. The webhook
  creates/loads an account keyed by that email — no separate email-code system to
  build for v1.
- **Re-auth later** via a magic link emailed to that same address (one
  transactional-email integration, deferred until needed).
- Session = opaque token in an `HttpOnly; Secure; SameSite=Lax` cookie, stored
  hashed in D1 (revocable).

> The free lite layer stays **accountless** — no login to read or to use private
> link-notes.

---

## 5. GPS-presence verification

**The pin stays ~18 m precise — that is unchanged.** This section is about a
*different* measurement: the publisher's **own phone GPS**, which has its own error.
Inside a building (where an occupant publishes) a phone fix is commonly 20–50 m off.
Demanding the phone report within 18 m with no allowance would reject legitimate
occupants standing in their own home. So we trust the device's *stated* uncertainty
rather than loosening the pin.

On publish, the client requests `navigator.geolocation`, which returns
`{lat, lon, accuracy}` (`accuracy` = error radius in metres). Server rule:

- **Accept** if the fix is consistent with the cell. ~50 m of GPS error is
  acceptable (agreed): `haversine(fix, pin) ≤ max(50 m, cellRadius + fix.accuracy)`.
  Tight when GPS is good; widens by the phone's own reported error; never changes
  the 18 m pin.
- **Reject as too vague** if `fix.accuracy` is worse than a cap (~100 m — that's
  wifi/cell-tower level, not real GPS) → prompt "move outside / try again".
- **Freshness / sanity**: require a recent fix; reject implausible jumps. GPS is
  spoofable by a determined actor, so this is *baseline* proof — reputation,
  reporting, and the later courier code cover the rest.
- **Privacy**: the fix verifies the publish only; **not stored as a track** — keep
  at most a boolean "location-checked" + timestamp.
- **Fallback**: no GPS / denied → no public publish (private link-notes still work);
  desktop publishing defers to the courier-code phase.

---

## 6. Data model (Cloudflare D1)

Trimmed from v1; append-only revisions remain the backbone.

```sql
users        (id, email UNIQUE, trust INT DEFAULT 0, status DEFAULT 'active', created_at)
sessions     (token_hash PK, user_id, expires_at, created_at)
pins         (id PK = 'CR/k3n8p2', country, code, lat, lon,
              public_revision_id,           -- current published public note
              claim_status DEFAULT 'unclaimed', claimed_by, claim_expires_at, created_at)
note_revisions (id PK, pin_id, body, author_id, status,   -- pending|published|rejected|superseded
              gps_checked INT, created_at)
reports      (id PK, revision_id, reporter_id, reason, status DEFAULT 'open', created_at)
```

Public **read path** (resolve code → public note) is hot and cacheable — mirror
the current published note into **KV** (`note:CR/k3n8p2`) for fast, cheap reads;
D1 is the system of record. Rate-limit counters in KV.

---

## 7. API surface (Pages Functions, `functions/api/`)

```
GET  /api/pins/:country/:code                 -> public note (if any) + trust label   [no auth]
GET  /api/pins/:country/:code/history          -> published revisions
POST /api/pins/:country/:code/public-notes     -> {body, gps:{lat,lon,acc}}  [account + GPS + paid]
POST /api/notes/:revisionId/report             -> {reason}                  [account]
POST /api/checkout                             -> create Stripe Checkout session
POST /api/stripe/webhook                       -> on paid: create/load account, mint session
GET  /api/me                                   -> {user, trust} | 401
# moderator-only
GET  /api/mod/queue ; POST /api/mod/revisions/:id {publish|reject|revert}
```

Frontend calls with `credentials:"include"`. The **lite build never calls these**
(feature flag off) and hides public-note UI.

---

## 8. Server-optional / lite mode

A single config flag (`NOTES_API` present or not):
- **Off** → static app only: code→directions + private link-notes + on-device
  manager. No Functions/D1/Stripe needed; deployable to any static host.
- **On** → adds the public-notes module against Cloudflare Functions + D1 + KV +
  Stripe. The frontend feature-detects and **degrades gracefully** if the API is
  unreachable (just hides public notes).

---

## 9. Payment (Stripe, hosted)

`POST /api/checkout` → Stripe Checkout session (collects email + payment) →
success redirect → `POST /api/stripe/webhook` verifies the event, creates/loads
the account, mints a session, and authorizes the public publish. Stripe secret key
stored via `wrangler pages secret put`. Stripe is the one external dependency, and
the right one (you want revenue + it doubles as identity + Sybil resistance).

**Pricing**: **$5 per public code** — a one-time charge per location (one public
note per code). Private/link notes are free. (Future: a recurring "control my
pins" plan for multi-location users — matches the real business model; not v1.)

---

## 10. Privacy (unchanged core rules)

- Verification/GPS **gates rights; never published as identity**. No "owned by X".
- GPS fix used to verify, **not stored as a location history**.
- Public note default = coarse; fine detail gated to authorized consumers (courier)
  in a later phase.
- Frame the paid feature as **"control what's shown about your place"**, not an
  ownership badge — better adoption hook and privacy-aligned.
- Report/takedown + honor deletion requests.

---

## 11. Phasing

- **Phase 1 — Lite manager (no server).** On-device named private notes + tailored
  share links. Ships independently, zero backend. *(Pure win, no risk.)*
- **Phase 2 — Paid public notes.** Accounts (Stripe-bootstrapped) + GPS-presence +
  fee → versioned public note keyed by code, reputation, report/moderation,
  graceful-degrade + feature flag.
- **Phase 3 — Stronger proof + monetization depth.** Courier claim-code → "verified
  occupant" + per-pin lock + time-decay; occupant detail-suppression; courier B2B
  read API.

## 12. Cost & ops

Infra fits Cloudflare free tiers early (D1, KV, Functions); Stripe takes its cut.
The real cost is **operational**: public content means a moderation/report/dispute
loop you must run. Phase 1 has none of that (nothing public), which is why it ships
first and standalone.

---

## Resolved (this review)

1. **New-account public notes** → auto-publish on GPS+fee, with the "under review /
   abuse removed" warning; moderate on report/review. ✓
2. **GPS check** → accuracy-aware rule, ~50 m acceptable (§5); pin precision
   unchanged at 18 m. ✓
3. **Pricing** → $5 per public code, one public note per code; private free (§9). ✓
4. **One public note per code** → yes; multi-audience variants live in the private
   link layer. ✓
5. **Moderation** → Matt for v1; evaluate Paperclip later. ✓

## Still open / future

- A recurring "control my pins" plan for multi-location users (post-v1; the real
  long-term business model).
