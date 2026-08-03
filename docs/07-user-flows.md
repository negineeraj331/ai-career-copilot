# User Flow Document — Career Copilot

**Last updated:** 2026-08-03

Each flow lists the happy path, the branches, the failure modes, and the empty states.
A flow is not designed until its failure modes are designed.

---

## 1. First-time user — landing to first score

The critical path. Every step here is measured; drop-off at any of them is a product bug.

```
Landing page
   │  hero animation: plain text resume reorganises into a formatted one
   ▼
[Get started]
   │
   ├─► Continue with Google ──┐
   ├─► Continue with GitHub ──┤
   └─► Email + password       │
          │                   │
          ▼                   │
   Registration form          │
   name, email, password      │
   (strength meter, breach warning)
          │                   │
          ▼                   │
   "Check your email"  ◄──────┘ (OAuth skips verification —
          │                      the provider already verified it)
          ▼
   Click verification link
          │
          ▼
   Onboarding — 3 questions, skippable
   1. What role are you targeting?
   2. Where are you now? (student / 0–2y / 3–5y / 5y+)
   3. Do you have a resume already?
          │
     ┌────┴─────┐
     ▼          ▼
  Upload     Start blank
  PDF/DOCX      │
     │          ▼
     │     Guided section-by-section builder
     ▼
  Parsing… (progress, ~10–30 s)
     │
     ▼
  Review extracted data
  ⚠ low-confidence fields flagged for confirmation
     │
     ▼
  [Confirm] → Resume created
     │
     ▼
  ATS score revealed (meter animates 0 → 78)
     │
     ▼
  "Add a job description to see how you match"  ← the activation moment
```

**Target:** landing → first score in under 4 minutes.

**Failure branches**

| Failure                         | Behaviour                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Verification email not received | "Resend" available after 60 s, rate-limited to 3/hour, with a spam-folder hint |
| Upload is not a PDF/DOCX        | Rejected at selection with the accepted list — never after a long upload       |
| File > 10 MB                    | Rejected client-side before upload with the actual size shown                  |
| Parsing fails entirely          | Offer manual entry with any partial text pre-filled. Never a dead end.         |
| Parsing partially succeeds      | Flagged fields highlighted; the user corrects inline and proceeds              |
| User abandons at review         | Draft saved with status `AWAITING_CONFIRMATION`; resumable from the dashboard  |

---

## 2. Login

```
Login page
   │
   ├─ email + password ─┐
   ├─ Google / GitHub ──┤
   └─ magic link ───────┤
                        ▼
              Credentials verified
                        │
              ┌─────────┴─────────┐
         MFA enrolled?        not enrolled
              │                    │
              ▼                    │
      Enter 6-digit code           │
      [Use a recovery code]        │
              │                    │
              └─────────┬──────────┘
                        ▼
              Session created → Dashboard
                        │
                        ▼
              Smart suggestion surfaces:
              "3 of your saved jobs want Docker. Your resume doesn't mention it."
```

| Failure                  | Behaviour                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Wrong password           | Generic "Email or password is incorrect" — identical for unknown emails                                    |
| 5 failures               | Locked with countdown: 1 → 2 → 4 → 8 → 16 min, capped at 30                                                |
| Unverified email         | "Verify your email to continue" + resend                                                                   |
| Wrong TOTP               | Retry, counted toward lockout; recovery-code link becomes prominent after 2 failures                       |
| Recovery code used       | Consumed, user warned how many remain, prompted to regenerate below 3                                      |
| Session expired mid-work | Silent refresh; if that fails, a modal preserving unsaved work — never a hard redirect that discards edits |

---

## 3. Editing a resume

```
Dashboard → resume card → Editor
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   Form (left)      Live preview (centre)   AI panel (right)
   sections,        template-rendered,      suggestions,
   drag to reorder  updates < 100 ms        warnings, actions
        │
        ├─ keystroke → debounced local render (no network)
        ├─ 2 s idle  → autosave → "Saved" indicator
        ├─ content hash change → new version snapshot (max 1/min)
        └─ score recompute → meter updates if changed
```

- **Autosave** is the only save. There is no save button, so there is no unsaved work.
- **Offline**: edits queue in IndexedDB; a banner shows offline state; the queue flushes on
  reconnect. The editor never blocks on the network.
- **Conflict** (same resume open in two tabs): `409` from the API triggers a diff modal —
  keep mine / keep theirs / merge. No silent overwrite.
- **Template switch**: preview updates immediately; content is untouched because content and
  presentation are separate by design. ATS-unsafe templates carry a warning badge.

---

## 4. JD analysis — the core loop

```
Editor → [Analyse against a job]
              │
              ▼
   Paste JD text (or pick a saved one)
              │
              ▼
   Parsing… (~3 s, streamed)
              │
              ▼
   ┌──────────── Results ────────────┐
   │  Match 87%   ATS 78             │
   │  ┌─ Skills      91% ───────────┐│
   │  ├─ Experience  80%            ││  each expandable to
   │  ├─ Projects    85%            ││  the evidence that
   │  └─ Education  100% ───────────┘│  produced it
   │                                 │
   │  Missing: Redis, Terraform      │
   │                                 │
   │  Recommendations (ranked)       │
   │  ① 3 bullets lack metrics  [Fix]│
   │  ② Docker not mentioned    [Add]│
   │  ③ Summary too generic  [Rewrite]│
   └─────────────────────────────────┘
              │
   Click [Fix] on a recommendation
              │
              ▼
   Editor scrolls to the exact field (JSON Pointer)
   AI proposes before → after
              │
     ┌────────┴────────┐
   [Accept]         [Reject]
     │                 │
     ▼                 ▼
  Applied,        Logged; the same
  version saved,  suggestion is not
  score updates   repeated this session
     │
     ▼
  Score delta animates: 78 → 84  (+6)
```

This loop is the product. Everything else supports it.

| Failure                         | Behaviour                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| JD text too short (< 100 chars) | "Paste the full description — short text produces unreliable matches"                                |
| JD unparseable                  | Fall back to keyword-only matching, clearly labelled as reduced confidence                           |
| AI provider down                | ATS score and keyword matching still render; AI recommendations show an unavailable state with retry |
| Quota exhausted                 | Deterministic results still shown; AI sections show remaining quota and upgrade path                 |

---

## 5. Accepting an AI suggestion (detail)

```
Suggestion card
 ┌──────────────────────────────────────────────┐
 │ Before                                       │
 │   Worked on website.                         │
 │                                              │
 │ After                                        │
 │   Built a React storefront serving           │
 │   [15,000] monthly users, cutting load       │
 │   time [37%] …                               │
 │                                              │
 │ ⚠ Two figures are placeholders. Confirm or   │
 │   correct them — never submit a number you   │
 │   cannot defend in an interview.             │
 │                                              │
 │ [Edit values]  [Reject]  [Accept]            │
 └──────────────────────────────────────────────┘
```

Accept is **disabled** until every placeholder is confirmed or edited. This is not friction
for its own sake: an unverified number on a resume becomes a question in an interview the
candidate cannot answer, and that is a worse outcome than a weaker bullet.

---

## 6. Version history

```
Editor → [History]
   │
   ▼
Timeline (newest first)
  ● v14  2 min ago   "Rewrote 3 experience bullets"   ATS 84
  ● v13  1 hr ago    "Added Docker to skills"         ATS 81
  ● v12  yesterday   "Imported from PDF"              ATS 71
   │
   ├─ [Preview]  → read-only render of that version
   ├─ [Compare]  → side-by-side diff, additions green / removals red / edits amber
   └─ [Restore]  → confirm → creates v15 with v12's content
                   (history is never rewritten)
```

---

## 7. Export

```
[Export] → choose format (PDF / DOCX / JSON / Markdown / LaTeX)
   │
   ├─ PDF: pre-flight ATS check
   │     └─ if template is ATS-unsafe: "This template may not parse well.
   │        Use the ATS-safe version for applications?"  [Switch] [Export anyway]
   │
   ▼
Queued → progress → download
   │
   └─ > 5 s: "We'll notify you when it's ready" and the user can navigate away
```

Failures: render error → retry once automatically, then a support link with the correlation
ID. Storage unavailable → job stays queued rather than failing; the user sees "pending".

---

## 8. Application tracking (v1)

```
Analysis results → [I applied with this]
   │
   ▼
Application created, pinned to the exact resume version sent
   │
   ▼
Kanban board
 ┌────────┬────────┬───────────┬──────────┬────────┬──────────┐
 │ Saved  │Applied │    OA     │Interview │ Offer  │ Rejected │
 └────────┴────────┴───────────┴──────────┴────────┴──────────┘
   │
   ├─ drag between columns → ApplicationEvent recorded (funnel + time-in-stage)
   ├─ set a follow-up date → reminder scheduled
   └─ click a card → the resume version actually sent, the JD, and the analysis
```

Pinning the version is what makes the analytics meaningful: "resumes scoring above 85 got
interviews 3× more often" is only a real claim if we know which document was sent.

---

## 9. Mock interview (v1)

```
JD → [Prepare] → question bank (technical / behavioural / HR / system design)
   │
   ▼
[Start mock interview] → chat or voice
   │
   ▼
AI asks → user answers → follow-up probes the weak part of the answer
   │  (5–10 questions)
   ▼
Feedback report
  Communication 7/10 · Technical accuracy 8/10 · Structure 6/10 · Confidence 7/10
  + per-answer notes, a model answer, and a link to the gap in the resume
```

Voice: microphone permission requested only at the moment it is needed, with a chat fallback
if denied. Recordings are processed and discarded; only the transcript and scores persist.

---

## 10. Sharing (v2)

```
Resume → [Share] → configure
  • slug: careercopilot.app/r/neeraj-backend
  • password (optional)
  • expiry (optional)
  • allow download (toggle)
   │
   ▼
Link + QR code
   │
   ▼
Recipient opens → [password gate] → read-only render
   │
   └─ view logged (timestamp, coarse location) → owner sees "Viewed 3 times"
```

Revoking is immediate. Expired or revoked links show a neutral "This link is no longer
available" — never the resume, and never a hint that it once existed.

---

## 11. Account deletion

```
Settings → Delete account
   │
   ▼
Explain exactly what happens:
  • resumes, versions, analyses, applications deleted
  • active subscription cancelled
  • security audit records retain a pseudonymous ID (legal requirement)
  • 30-day grace period before purge
   │
   ▼
Re-authenticate (password or OAuth)
   │
   ▼
Type the account email to confirm
   │
   ▼
Offer an export first: [Download my data]
   │
   ▼
Scheduled for deletion + confirmation email with an undo link (30 days)
```

The export offer sits _after_ the confirmation, not before — a user who is leaving should not
have to fight a retention flow, but they should not lose their data by accident either.
