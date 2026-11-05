# Setting up MY/CO/L, step by step

You never need to type git commands. Everything below is clicks in a web browser. Do the parts in order,
and only when you want them: the app already runs without any of them (it says LOCAL MODE).

| Part | When | Cost |
| --- | --- | --- |
| 1. Test link | Now | Free |
| 2. GitHub Pages | Now, for a real address you can install on your phone | GitHub Pro, about US$4/month |
| 3. Supabase (database and login) | When you want to save farm records | Free |
| 4. Cloudflare Pages | At launch | Free |

Passwords and keys always go in those websites' dashboards, never in the code.

---

## 1. Test link (nothing to set up)

Each build thread gives you a private claude.ai link to a test copy. Only you can open it. Tap the screen to
power it on. It can't be installed or used offline, which is what part 2 is for.

---

## 2. GitHub Pages

A private repository can only use GitHub Pages on a paid plan. The site itself is public to anyone who has
the address, so this is for testing until launch, before your MycoWizards reference content goes in.

1. **Upgrade to GitHub Pro.** Go to <https://github.com/settings/billing/summary>, choose
   **Upgrade** next to your plan, pick **Pro**, and pay. You can cancel after moving to Cloudflare.
2. **Merge the build 1 pull request.** Open the pull request link from the thread, scroll down, press
   **Merge pull request**, then **Confirm merge**.
3. **Turn Pages on.** In the repository, go to **Settings** (top tab) > **Pages** (left menu). Under
   **Build and deployment**, set **Source** to **GitHub Actions**. Nothing else to change.
4. **Run the first publish.** Go to the **Actions** tab, click **Deploy to GitHub Pages** on the left,
   then **Run workflow** > **Run workflow**. Wait for the green tick (about 1 minute).
   After this it runs by itself every time you merge.
5. **Open it.** Back in **Settings** > **Pages**, the address is shown at the top, something like
   `https://josephmclachlan.github.io/MY-CO-L/`.
6. **Install it on your phone.**
   - iPhone (Safari): Share button > **Add to Home Screen**.
   - Android (Chrome): menu (three dots) > **Install app** or **Add to Home screen**.
   Once opened one time with signal, it also opens with no signal.

---

## 3. Supabase (database and login)

1. Go to <https://supabase.com> and press **Start your project**. Choose **Continue with GitHub** and approve.
2. Create an organization if asked (name: Negra Bay Biologics, plan: **Free**).
3. Press **New project**:
   - Name: `my-co-l`
   - Database password: press **Generate a password**, then save it in your password manager.
   - Region: **East US (North Virginia)**, the closest to Costa Rica.
   - Press **Create new project** and wait about 2 minutes.
4. **Create the tables.** In GitHub, open `supabase/migrations/0001_initial_schema.sql` and press the
   **copy** button (two squares, top right of the file). In Supabase, open **SQL Editor** (left menu),
   press **New query**, paste, and press **Run**. It should say *Success. No rows returned*.
5. **Stop strangers signing up.** **Authentication** > **Sign In / Providers**: turn **off**
   *Allow new users to sign up*, then **Save**.
6. **Make your login.** **Authentication** > **Users** > **Add user** > **Create new user**. Enter your email
   and a passcode, tick **Auto Confirm User**, press **Create user**.
   **Then lock it to you.** Back in **SQL Editor** > **New query**, open `supabase/migrations/0002_cargo_and_owner_lock.sql`
   in GitHub, copy it, paste, **Run**. It adds the stock tables CARGO needs and makes every table readable and
   writable by your login only (anyone else who somehow signed in would see nothing). Make your login (this step)
   BEFORE running it, because it adds everyone who exists at that moment to the allowed list.
   **Then the genetics lab.** Same way: copy `supabase/migrations/0003_genetics.sql`, paste, **Run**. It lets the
   XENOGENETICS screen store strains by species, master (P0) cultures, water tubes and cryovials, grain-run status
   and cold-storage dates. Then `0004_hazard_links.sql` (loss logging against the HAZARD INDEX) and
   `0005_cook_log.sql` (the PROPULSION cook log columns). Run each file once, in number order.
7. **Copy the two public values.** **Project Settings** (gear icon) > **API Keys** (or **Data API**):
   - the **Project URL** (looks like `https://abcd1234.supabase.co`)
   - the **publishable** key (or, on older screens, the **anon public** key).
   Never copy the *secret* or *service_role* key anywhere.
8. **Give them to GitHub Pages.** In the repository: **Settings** > **Secrets and variables** > **Actions** >
   **Variables** tab > **New repository variable**. Add two:
   - Name `VITE_SUPABASE_URL`, value: the Project URL
   - Name `VITE_SUPABASE_KEY`, value: the publishable (or anon) key
9. Re-run **Actions** > **Deploy to GitHub Pages** > **Run workflow**. The app now shows **DB LOCKED**.
   Press **F8 LOGIN** and sign in with the email and passcode from step 6.

**Moving your local CARGO data across.** If you used the app in local mode first: before linking, open CARGO and press
**EXPORT BACKUP** on the device that holds your counts. After linking and logging in, open CARGO and press
**IMPORT BACKUP** and pick that file. It merges by id, so importing twice does no harm.

Good to know: a free Supabase project pauses after a week with no use. Your data is kept; open the Supabase
dashboard and press **Restore** to wake it.

---

## 4. Cloudflare Pages (at launch)

Cloudflare is free, gives a preview address for every pull request before you merge, and can lock the site
so only your email can open it.

1. Sign up at <https://dash.cloudflare.com/sign-up> and confirm your email.
2. In the dashboard: **Workers & Pages** > **Create** > **Pages** tab > **Connect to Git**.
3. Choose **GitHub**, approve Cloudflare, pick **Only select repositories** > **MY-CO-L**, and save.
4. Back in Cloudflare, select **MY-CO-L** > **Begin setup** and fill in:
   - Project name: `my-co-l`
   - Production branch: `main`
   - Framework preset: **Vite** (or None)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (same values as above), and
     `NODE_VERSION` = `22`
5. Press **Save and Deploy**. Your address is `https://my-co-l.pages.dev`.
6. Optional, recommended once reference content is in: **Zero Trust** > **Access** > **Applications** >
   **Add an application** > **Self-hosted**, domain `my-co-l.pages.dev`, policy **Allow** > **Emails** >
   your email. Only you (and anyone you add, up to 50 free) can open it.
7. When Cloudflare works, turn GitHub Pages off (**Settings** > **Pages** > **Unpublish site**) and you can
   cancel GitHub Pro.

If Cloudflare's screen only offers **Workers** (no Pages tab): choose **Import a repository**, pick
MY-CO-L, build command `npm run build`, deploy command `npx wrangler deploy`. The repo already has the
`wrangler.jsonc` file this needs.

## The MANUAL tab (private test copy only)

The textbook lives in the MANUAL module. It is built into the private test copy only. The public GitHub Pages build shows `MANUAL LOCKED // LOGIN REQUIRED` and does not contain any textbook text (the build swaps the data for an empty file).

- Make the test copy with the textbook: `npm run build:preview` (reads the chapters from `MANUAL_SRC`, default `/mnt/project-files/knowledge/01-core-knowledge/textbook`).
- The generated data is `src/manual-data/manual.json`. It is gitignored and must never be committed.
- Once Supabase login is linked, serve the same JSON behind the login and remove the `MANUAL` gate in `vite.config.ts`.
