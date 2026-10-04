# Alora Portal

Two apps in one site:

- **Client app**: `https://YOUR-SITE/h/<private-code>`. Each client has their own link, with no sign-in. It only shows that one home.
- **Admin app**: `https://YOUR-SITE/admin`. Only you (and anyone you add as admin) can sign in.

## 1. Set up the database (Supabase, 5 minutes)

1. Supabase > **SQL Editor** > New query > paste all of `supabase/schema.sql` > **Run**.
2. Optional: run `supabase/seed-demo.sql` to get a demo home at `/h/demo-harrington-2026`.
3. **Authentication > Sign In / Providers**: keep Email on. Turn **off** "Allow new users to sign up".
4. **Authentication > Users > Add user**: your email and a password, with "Auto confirm" checked.
5. Back in the SQL Editor, make yourself admin (use your email):
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'you@youremail.com'
   on conflict do nothing;
   ```
6. **Authentication > URL Configuration**: set Site URL to your Vercel address, and add `https://YOUR-SITE/admin` to Redirect URLs (used for "Forgot password").

## 2. Put it online (Vercel, 3 minutes)

1. Vercel > Add New > Project > import this folder (from GitHub, or drag it in with the Vercel CLI: `npx vercel` inside this folder).
2. Framework preset: **Other**. No build command. Output directory: leave empty (the root).
3. Deploy. Open `https://YOUR-SITE/admin` and sign in.

## 3. Daily use

- **Team**: add your cleaners (first name and a color).
- **Settings**: Google review link, referral offer and link, standard checklist.
- **Homes > New client**: creates the home with the standard rotation. Then **Copy** or **Text link** to send it.
- **Today**: tap *On the way*, *Arrived*, then *Finish visit* (pick the areas that got extra attention, add photos and a note). The client sees each step live, and the next visit is created automatically.
- **Inbox**: client messages, requests (date changes, skips, pauses, cancellations) and touch-ups. Requests don't change anything on their own. Make the change, then tap *Done*.
- **New link** on a client page replaces their link right away (use it if a link was shared by mistake). **Turn link off** blocks it.

## Good to know

- The anon key in `assets/config.js` is meant to be public. Data is protected by the database rules in `schema.sql`.
- Entry notes and private notes are never sent to clients.
- Anyone who has a client's link can see that home. Clients are told to share it only with their household.
- Photos are stored in Supabase Storage with long random names.
- Tips are recorded, not charged. You charge them with the visit.
- **Supabase free plan pauses a project after about a week without activity.** If that happens, client links stop working until you restore it. For a client-facing app, the Pro plan avoids this.
