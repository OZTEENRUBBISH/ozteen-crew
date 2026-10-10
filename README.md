# OzTeen Crew board: setup guide

Goal: the crew board live at **https://crew.ozteen.com** with real logins, a shared database and photo uploads. Allow about 30–45 minutes, most of it waiting for the domain to connect.

What's in this folder:

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The website |
| `config.js` | Where you paste your two Supabase values (step 1.6) |
| `CNAME` | Tells GitHub Pages to use crew.ozteen.com |
| `setup.sql` | Creates the database, security rules and photo storage (step 1.2) |

---

## Part 1: Supabase (the database and logins), about 10 minutes

**1.1 Make the project**
1. Go to supabase.com and sign up (signing in with GitHub is quickest).
2. Click **New project**. Name it `ozteen-crew`, pick a strong database password (save it somewhere), choose the **Sydney** region and the **Free** plan.
3. Wait a minute or two while it sets up.

**1.2 Create the database**
1. In the left menu open **SQL Editor** and click **New query**.
2. Open `setup.sql` from this folder, copy everything, paste it in and click **Run**.
3. You should see "Success. No rows returned". (A warning about "destructive operations" is expected. Confirm it.)

**1.3 Turn off public sign-ups** (so only people you add can get in)
1. Open **Authentication**, then **Sign In / Providers** (on some dashboards it's under **Authentication → Providers → Email** or **Settings**).
2. Turn **off** "Allow new users to sign up". Leave the **Email** provider switched on.

**1.4 Tell Supabase your web address**
1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to `https://crew.ozteen.com`
3. Under **Redirect URLs** add `https://crew.ozteen.com` and click Save.

**1.5 Create your account and Nick's**
1. Open **Authentication → Users**, click **Add user → Create new user**.
2. Enter your email and a temporary password, tick **Auto Confirm User**, click **Create user**.
3. Do the same for Nick.
4. Back in **SQL Editor**, run this (with your real emails) to make you both owners:

```sql
update public.profiles set role = 'owner'
where email in ('YOUR-EMAIL@example.com', 'NICKS-EMAIL@example.com');
```

**1.6 Copy your two keys into `config.js`**
1. Open **Project Settings → API Keys** (or **Settings → API** on older dashboards).
2. Copy the **Project URL** (looks like `https://abcd1234.supabase.co`). If it isn't on that page, it's under **Project Settings → Data API**.
3. Copy the **publishable** key (starts with `sb_publishable_`). If you only see a "Legacy API keys" tab, use the **anon public** key instead.
4. Open `config.js` in VS Code and paste them in place of the placeholders.

> Never paste the **secret** or **service_role** key into any website file. The publishable key is designed to be public; the security rules protect the data.

---

## Part 2: GitHub Pages (the hosting), about 5 minutes

1. On GitHub create a new repository called `ozteen-crew`. Make it **Public** (free GitHub Pages needs a public repo; nothing secret is in these files).
2. Add the files the same way you do for your other OzTeen sites (VS Code → commit → push), or click **Add file → Upload files** and drag in everything from this folder.
3. In the repo open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
5. Under **Custom domain** you should see `crew.ozteen.com` (the CNAME file sets it). If not, type it in and click **Save**.

---

## Part 3: Namecheap DNS (connect crew.ozteen.com), about 2 minutes plus waiting

1. Log in to Namecheap → **Domain List** → **Manage** next to ozteen.com → **Advanced DNS**.
2. Click **Add New Record**:
   - Type: **CNAME Record**
   - Host: `crew`
   - Value: `YOUR-GITHUB-USERNAME.github.io` (the account or organisation that owns the repo)
   - TTL: Automatic
3. Click the green tick to save. **Don't change the existing records** for ozteen.com; your main site depends on them.
4. Wait. Usually 5–30 minutes. Back in GitHub **Settings → Pages**, the DNS check turns green.
5. Tick **Enforce HTTPS** once it's available (GitHub needs a little while to issue the certificate; until then the box is greyed out).

---

## Part 4: First sign-in and a 5-minute test

1. Go to **https://crew.ozteen.com** and sign in with your email and temporary password.
2. It asks for your name and a new password. That's the first-login step every crew member gets.
3. Test it:
   - **Jobs calendar:** pick a day, add a test job, assign yourself.
   - **My availability:** set a few days. "Saved" appears top right.
   - **Upcoming jobs:** open the job card and add a photo from your phone.
   - **Team accounts:** you and Nick should be listed as Owner.
4. Open it on your phone too, and get Nick to sign in and check he sees your test job.

---

## Adding crew

1. Supabase → **Authentication → Users → Add user → Create new user**: their email, a temporary password, tick **Auto Confirm User**.
2. Text them `crew.ozteen.com`, their email and the temporary password.
3. On first sign-in they set their own name and password. They then appear under **Team accounts**.

To remove someone: **Team accounts → Remove access**. They're locked out straight away. Their past availability stays in the records.

---

## When someone forgets their password

Supabase's free built-in email only sends to members of your Supabase team, 2 emails an hour. So until you do Part 5, reset emails won't reach crew. Instead, set a new temporary password for them in **SQL Editor**:

```sql
update auth.users
set encrypted_password = extensions.crypt('NewTemp-2026', extensions.gen_salt('bf'))
where email = 'THEIR-EMAIL@example.com';

update public.profiles set must_change_password = true
where email = 'THEIR-EMAIL@example.com';
```

Text them the temporary password. The site makes them choose a new one when they sign in.

---

## Part 5 (optional, do it this week): working "Forgot password" emails

Connect a free email sender so reset links actually send:

1. Sign up to an email service such as **Resend** or **Brevo** (both have free tiers).
2. Verify ozteen.com with them. They give you a few DNS records to add in Namecheap **Advanced DNS**, like the CNAME above.
3. In Supabase open **Authentication → Emails → SMTP Settings**, switch on custom SMTP and paste the host, port, username and password the service gives you. Use a sender like `crew@ozteen.com`.
4. Test: sign out, click **Forgot password?**, and check the email arrives.

After this, **Forgot password** on the sign-in page and **Send reset link** on Team accounts both work.

---

## Good to know

- **Free plan limits:** a free Supabase project pauses after about a week with no activity. Daily use keeps it awake. If it ever pauses, click **Restore** in the Supabase dashboard. Photo storage is 1 GB on free, which holds thousands of job photos (the site resizes them before upload).
- **Backups:** the free plan doesn't include automatic backups you can restore. Every so often, export the tables from **Table Editor** (each table → Export to CSV).
- **Who can do what:** crew see all jobs and everyone's availability, set their own availability, and add photos. Only owners add, edit or delete jobs and manage accounts. Removed crew see nothing. These rules live in the database, so they hold even if someone tinkers with the website code.

## Troubleshooting

| Problem | Fix |
|---|---|
| Page says "Setup isn't finished" | `config.js` still has the placeholders. Paste the URL and key, then push again. |
| "That email and password don't match" | Check the account exists in Supabase → Authentication → Users and was created with **Auto Confirm User** ticked. |
| "Your account isn't set up on the crew board yet" | The account was created before `setup.sql` ran. Run `setup.sql` again (it's safe to re-run). |
| Can't add jobs | Only owners can. Run the step 1.5 SQL with your exact email. |
| crew.ozteen.com doesn't load | DNS can take up to a few hours. Check the Namecheap CNAME Host is `crew` and the Value is `yourusername.github.io`. |
| Site loads without the latest changes | GitHub Pages takes a minute or two after each push. Refresh with Ctrl+Shift+R. |
