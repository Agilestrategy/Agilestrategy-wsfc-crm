# WSFC Club CRM

Club operations CRM for the Whakatane Sportfishing Club. Part of the "Securing the Next 60 Years" programme.
Vite + React front end, Supabase (Postgres, auth, RLS) backend, deployed on Netlify.

## What is here

| Area | Files |
|---|---|
| Database schema, RLS, views, matching function | `supabase/migrations/0001_init.sql` |
| First staff login and starter tags | `supabase/seed.sql` |
| Admin console | `src/pages/*` (Dashboard, Members, Member detail, Email contacts, Import, Staff) |
| CSV import engine (members list + Mailchimp audience) | `src/lib/importer.js` |
| Server-side Mailchimp importer (optional) | `scripts/import-mailchimp.mjs` |

## Set up once

1. **Supabase.** Open the project's SQL editor, paste and run `supabase/migrations/0001_init.sql`, then `supabase/seed.sql`.
   Authentication → Providers → Email: enable, turn off "Confirm email" if you want one-click links, and add the Netlify URL (and `http://localhost:5173`) to Authentication → URL configuration → Redirect URLs.
2. **Local.** `cp .env.example .env`, fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then `npm install && npm run dev`.
3. **Netlify.** New site from this repo. Build command and publish dir come from `netlify.toml`. Add the two `VITE_` variables under Site configuration → Environment variables.
4. Sign in with a magic link using an email that is on the `staff` table (Paul's is seeded). Add others on the Staff page.

## Loading data

- **Mailchimp audience export** (subscribed / unsubscribed / cleaned / nonsubscribed CSVs): Import page, pick each CSV in turn. The file name decides the status. Or run `node scripts/import-mailchimp.mjs ./data/audience_export` with the service-role key in the environment.
- **Members list** from the old system: Import page, pick the CSV, check the column mapping (it guesses), choose how to match existing records (member number, email, or name), import. Re-importing updates in place.
- After any import the console runs `match_email_contacts()` which links Mailchimp contacts to members by email, then by unique first+last name, and fills blank member emails from subscribed contacts.

## Data model, in one breath

`members` is the core record (category, status, financial-until, contact details, household link, legacy IDs, raw import row). `subscriptions` holds one row per season for renewal history. `cards` and `engagements` are the swipe and activity feed that the Status programme (Black / Gold / Silver) will score; gaming-floor swipes earn zero points by design. `interactions` are notes, calls and tasks. `email_contacts` is the Mailchimp audience kept as its own truth and linked to members when matched. `staff` gates the console; RLS gives active staff full access and lets a member read only their own row (for the portal phase).

## Roadmap (per the CRM module agreement)

1. Foundation: schema, import, admin shell. **This.**
2. Capture surfaces: membership form, day-membership QR, merch pre-order feeding `members` directly.
3. Renewals: T-30 / T-7 / T+7 reminders, expired-card door catch, season rollover.
4. Status programme: tier calculation from `engagements`, member-facing status portal (magic link).
5. Club website rebuild on the club's domain, with the forms above as the single intake.
