# The `dev` database: seeding and rebuilding

How to fill Neon `dev` with demo data, and how to rebuild it from nothing, without touching production. Follow the steps in order. The scripts refuse most mistakes, but not all of them.

`dev` is the Neon branch that your machine, **Staging** and every **PR preview** use. Whatever you do to it shows up on the staging URL straight away. `prod` is a separate branch used only by the production site. Nothing in this document ever touches it.

---

## The rules

| Rule | Why |
|---|---|
| Never run a seed or reset command with production values in `.env.local` | Both commands write as the database owner. They refuse any host but `SEED_DATABASE_HOST`, so keep that set to the `dev` host only |
| Never type `DROP …` into the Neon SQL editor | The editor's branch picker is easy to leave on `prod`. Use `vp run db:reset-dev`, which checks the host first |
| Never use Neon's **Reset from parent** on `dev` | It copies `prod`'s rows into `dev` (real customers' data once Kerb is live), and `prod`'s audit rows are signed with production keys, so `dev`'s audit chain stops verifying |
| Run seed and reset from your own machine only | Neither ever runs in a Vercel build; both refuse if `VERCEL_TARGET_ENV` is set |
| Don't sign up on staging with a cast address (`+customer-a`, `+handler` …) | The seed would hit a duplicate address and stop. To test plus addressing, use something like `+test` |

---

## One-time setup

Add these to `.env.local`. Never commit them; `.env.example` lists the names only.

| Variable | Value |
|---|---|
| `SEED_DATABASE_HOST` | The `dev` branch's **direct** host (Neon → `dev` → Connect, pooling off), for example `ep-dry-scene-….eu-west-2.aws.neon.tech`. It must match the host in `DATABASE_URL_UNPOOLED` |
| `SEED_INBOX` | `damionwilson@opsedsolutions.com`. The cast's addresses are `+role` variants of it |
| `SEED_PASSWORD` | At least 10 characters. Every cast member signs in with it |
| `SEED_TOTP_SECRET` | 32 letters and digits, generated once (below) |

Generate the TOTP secret:

```
node -e "const c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';console.log(Array.from(require('crypto').randomBytes(32),b=>c[b%62]).join(''))"
```

Keep `SEED_TOTP_SECRET` the same from then on. Your authenticator app entry then keeps working through every rebuild.

Check once that a `+` address reaches your inbox: send a test email to `damionwilson+test@opsedsolutions.com`.

---

## A. Seed `dev` (when it has no demo data)

Use this the first time, or after a rebuild that stopped before the seed.

1. Make sure `dev` is migrated and has its reference data: `vp run db:migrate`, then `vp run db:reference`.
2. `vp run db:seed`
   - It prints `Database: <host>`. **Check it's the `dev` host.**
   - It prints `Seeded:` and a count per table, about 2,000 customers.
   - The first time, add the printed `otpauth://` link to your authenticator app (one entry covers the handler and the admin). Keep the printed backup codes somewhere safe; they aren't shown again.
3. Run `vp run db:seed` again. It should print `Already seeded:` with the same counts. That's the proof it changed nothing.
4. On the staging URL, sign in as customer A with `SEED_PASSWORD`, then as the handler with a code from the app.

A second seed never adds more data. To change what's seeded, rebuild (B).

---

## B. Rebuild `dev` from nothing

Use this when the seed's code changes (for example, 5.4 replaces the stand-in pricer), when `dev`'s data is in a mess, or before a recording.

**What you lose:** everything on `dev`, including any accounts you made by hand, your own admin account among them. Staging and previews share `dev`, so they lose it too.

1. Check `.env.local` has the four `SEED_*` values (above). The reset checks them **before** deleting anything, so a bad value stops it with `dev` untouched.
2. Run it without `--confirm` first:

   ```
   vp run db:reset-dev
   ```

   It deletes nothing. It prints the host it would empty and the exact command to run. **Read the host and check it's `dev`.**
3. Copy the printed command, which names the host:

   ```
   vp run db:reset-dev -- --confirm <dev host>
   ```

   It then empties the database and runs, in order:
   - migrations
   - reference data
   - seed
   - the app role check

   If a step fails, it stops and names the command to carry on from.
4. The seed prints new backup codes; keep them. The authenticator entry still works.
5. Bring your own admin back. Sign up on the staging URL with your usual address, confirm the email, then:

   ```
   vp run auth:make-admin <your email> --name "<your name>"
   ```

6. Do the checks in A, step 4.

The reset keeps the `kerb_app` role and its password, because roles belong to the Neon branch, not its tables. Migration `0010` grants it again.

---

## C. The account closure check (4.7)

This uses the two closure cast members. Run it on a freshly seeded `dev`, because it closes one of them for good. A rebuild (B) brings it back.

1. On the staging URL, sign in as `+closure-settled`, go to Account → Close account, and confirm with the password. Do the same for `+closure-held`. Two "closure requested" emails arrive.
2. Locally, act 31 days later:

   ```
   NOW=<request time + 31 days, e.g. 2026-12-10T09:00:00Z> vp run jobs:daily
   ```

3. Check in the Neon console, on the `dev` branch:
   - **Closure, settled:** `account_closures.closed_at` is set. The user's email is `closed+…@closed.invalid`. The policy and claim are still there, and `audit_log` has `account.closed`.
   - **Closure, held:** `held_since` is set and the account is still open, because its claim is open.
   - The script prints `Emails waiting: 2` (or more). That's by design: without `SEND_EMAILS=1` the "closed" and "held" emails stay queued. `SEND_EMAILS=1 vp run jobs:run` sends them; in production the daily cron does.
   - `closed_at` shows the real time of the run, not the `NOW` you gave, because the database clock stamps it.

---

## D. Uploads on dev (4.10)

Files go to the `kerb-dev` bucket, set by the `R2_*` values in `.env.local` (and in Vercel's Development, Preview and Staging).

- **Check the bucket:** `vp run uploads:check-r2` puts, heads, reads, signs a GET for and deletes one object. Every line should say `ok`.
- **The test page:** `/dev/uploads`, locally or on staging, never in production.
  - **Ben Okafor** (`+customer-b`): his claim KRB-C-90001 is being assessed, so it takes photos and PDFs.
  - **Amelia Hart** (`+customer-a`): her claim KRB-C-90000 is settled, so it refuses new files.
  - **The handler** (`+handler`): the staff box opens any claim's files, and each one opened writes a `file.viewed` audit row.
- **Cleanup:** `vp run jobs:daily` runs the daily jobs, the uploads cleanup among them, which deletes the objects of stale, rejected and deleted files. Add `NOW=<a day later>` to take an upload left pending.
- **After a rebuild (B):** the database forgets its files, but the bucket keeps their objects. They're harmless. To clear them, empty `claim_photo/`, `claim_document/` and `review_photo/` in the Cloudflare dashboard.

---

## The cast

All addresses are `+role` variants of `SEED_INBOX`. Every customer's password is `SEED_PASSWORD`.

| Who | Address | What's on file |
|---|---|---|
| Customer A, Amelia Hart | `+customer-a` | Car and home bundle, a settled claim, a published review |
| Customer B, Ben Okafor | `+customer-b` | Car policy, a claim being assessed by the handler |
| Business owner, Priya Shah | `+business` | Florist's policy, a bigger quote referred and waiting |
| Closure, settled, Tom Reed | `+closure-settled` | Car policy, one settled claim |
| Closure, held, Grace Lin | `+closure-held` | Home policy, an open claim |
| Claims handler, Sam Carter | `+handler` | Staff; 2FA from `SEED_TOTP_SECRET` |
| Admin, Jordan Ellis | `+admin` | Staff; same 2FA entry |

---

## When something goes wrong

| You see | It means | Do |
|---|---|---|
| `SEED_DATABASE_HOST must be only the host …` | You pasted the whole connection string | Keep only the host, e.g. `ep-….neon.tech` |
| `SEED_DATABASE_HOST doesn't match …` | `.env.local` points somewhere other than `dev` | Stop. Check `DATABASE_URL_UNPOOLED` and `SEED_DATABASE_HOST` |
| `The seed never runs in a Vercel build` | `VERCEL_TARGET_ENV` is set in your shell | Open a fresh terminal |
| `This deletes everything in …` | `db:reset-dev` without `--confirm` | Read the host. If it's `dev`, run the printed command |
| `Reference data is missing: run vp run db:reference first` | `dev` is migrated but empty | `vp run db:reference`, then seed again |
| `Already seeded:` | `dev` already has demo data | Nothing to do. To start over, rebuild (B) |
| `Failed: … (23505)` from the seed | A cast address is already taken (someone signed up with it) | Rebuild (B) |
| Handler's code fails on staging but works locally | Your local `BETTER_AUTH_SECRET` differs from Staging's | Set `SEED_BETTER_AUTH_SECRET` to Staging's value, then rebuild (B) |
| `<step> failed. Fix it, then carry on from: …` | A rebuild stopped partway | Fix the cause, run the named command, then the remaining steps in B.3 by hand |

---

## E. Background jobs on dev (4.11)

Vercel Cron only calls Production, so on dev the two crons are run by hand:

- **`vp run jobs:run`:** the 6-hourly retry run. It runs every job whose time has come.
- **`vp run jobs:daily`:** the daily run. It queues today's closures, uploads cleanup, housekeeping and audit anchor (once per UTC day), then runs them.
- **`NOW=<ISO date>`:** runs either as if it were that time, for example a retry 6 hours on, or closures 31 days on.
- **Emails:** left queued, never sent or marked done, and counted ("Emails waiting: N"), since `dev` is full of seeded addresses and a waiting email (a staging sign-up's, say) mustn't be lost. `SEND_EMAILS=1` sends them through Resend for real.
- **Looking at jobs:** the `jobs` table in the Neon console or Drizzle Studio. A `failed` job shows its `run_after` and `last_error`, and a `dead` one stays for 30 days.
- **The audit chain:** `vp run audit:verify` checks the chain and every anchor in `kerb-dev`, and prints `Chain OK: N rows. Anchors OK: M.`. Anchors are locked for 365 days by the bucket rule, so they outlive a database rebuild (B). After a rebuild, `audit:verify` reports `anchor_row_missing` for the old anchors. That's expected: the database they anchored is gone.
