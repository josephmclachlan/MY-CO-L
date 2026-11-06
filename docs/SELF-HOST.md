# Running MY/CO/L on the farm's own computer

This puts the app, all the farm records, the logins and the assistant's local model on one small computer at
the farm (the "farm box"). Phones and laptops open it from a private https address. Nothing needs Supabase,
and nothing needs git. The full reasoning (which computer, costs in colones, power cuts) is in the self-host
plan in the project files (`app-plans/self-host-plan.md`).

What runs on the box, all inside Docker:

| Part | What it does | Memory (measured) |
| --- | --- | --- |
| `db` (Postgres 16) | every farm record | about 80 MB |
| `auth` (GoTrue, Supabase's own login program) | email + passcode logins | about 10 MB |
| `rest` (PostgREST, Supabase's own table server) | the app reads and writes tables | about 20 MB |
| `web` (Caddy) | serves the app, and puts the tables, login and model under one address | about 25 MB |
| `ollama` (optional) | the assistant's local model | 3-7 GB while answering |
| `bridge` (optional) | reads Govee sensors into ATMOSPHERICS every 10 minutes | about 40 MB |

The app talks to `auth` and `rest` exactly as it would talk to Supabase, so no screen changes. The database
changes in `supabase/migrations` run unchanged (tested: all 17 apply, login works, a stranger cannot sign up,
a visitor who is not logged in sees nothing).

---

## 1. The computer

Recommended: a mini PC with an AMD Ryzen chip and 16 GB of memory, 512 GB or 1 TB SSD. See the plan for the
models and prices. Install **Ubuntu Server 24.04 LTS** on it (a USB stick made with balenaEtcher or Rufus;
choose "Install OpenSSH server" during setup). Then, on the box:

- Set the clock zone: `sudo timedatectl set-timezone America/Costa_Rica`
- In the BIOS (press Del or F7 at power on): **Restore on AC power loss = Power On**. The box then starts by
  itself when power comes back.

To try it on your own Windows PC first: install **Docker Desktop** (it sets up WSL), open the **Ubuntu** app it
installs, and do the steps below inside that window. Your PC has to stay on for phones to reach it.

## 2. Docker

On the box (copy and paste, one line at a time):

```
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in (or reboot) once.

## 3. Get the farm box files

Every time a change is merged, GitHub makes a fresh download called **mycol-selfhost.tar.gz** on the repository's
**Releases** page (release "Farm box (newest)", right side of the repository page).

- Download it in your browser (you are logged in to GitHub), copy it to the box (USB stick, or `scp`), then:

```
mkdir -p ~/mycol && tar -xzf mycol-selfhost.tar.gz -C /tmp && cp -r /tmp/mycol-selfhost/selfhost/. ~/mycol/
cd ~/mycol && ./mycol.sh setup && ./mycol.sh update ~/mycol-selfhost.tar.gz
```

`setup` makes the secret keys (saved in `~/mycol/.env`; copy that file into your password manager).
`update` puts the app and the database changes in place.

## 4. The private https address (Tailscale)

Phones need https for the app to install and work offline. Tailscale gives the box a private https address that
only your own devices can open, at the farm or anywhere else, with nothing open to the internet.

1. Make a free account at <https://tailscale.com> (Sign in with Google or GitHub).
2. On the box: `curl -fsSL https://tailscale.com/install.sh | sh` then `sudo tailscale up` and open the link it
   prints to approve the box.
3. In the Tailscale admin page, **DNS**: turn on **MagicDNS** and **HTTPS Certificates**.
4. On the box: `sudo tailscale serve --bg 8080`. It prints the address, like
   `https://farm-box.tail1234.ts.net`.
5. Put that address in `~/mycol/.env` as `SITE_URL=` (no slash at the end).
6. Install the Tailscale app on each phone and laptop and sign in with the same account.

Staff phones: each needs Tailscale too. Tailscale's free plan covers a few people; check its current limits.
If you need many staff phones, the plan explains the Cloudflare Tunnel option instead.

## 5. Start it and make your login

```
cd ~/mycol
./mycol.sh start
./mycol.sh add-user you@example.com
./mycol.sh migrate
./mycol.sh install-timers
```

Order matters: make your login **before** `migrate`, because the database locks every table to the logins that
exist at that moment (same as the Supabase steps). `install-timers` turns on the nightly backup.

Open the https address on your phone, tap to power on, log in. The header should say **DB LINKED**.
Moving records you already typed in LOCAL MODE: on the old device, DATA > BACKUP (ZIP); on the box's address,
log in, DATA > RESTORE.

Staff logins: `./mycol.sh add-user helper@example.com`, then copy the SQL from the app's STAFF screen into
`./mycol.sh sql`.

## 6. The assistant's model (optional)

```
./mycol.sh model qwen2.5:7b      # Ryzen box, 16 GB
./mycol.sh model qwen2.5:3b      # Intel N150 box, or to compare
```

In the app: **ASK > ENGINE**: ENGINE **OLLAMA**, ADDRESS **/llm**, MODEL the name above, SAVE, TEST CONNECTION,
RUN TEST QUESTIONS. Keep the model that scores 7 or 8 of 8 at a speed you can live with.
`/llm` is the box's own address, so it works from phones too. Only the chat and model-list calls pass through;
nobody can download or delete models from a browser.

The first question after a restart (or each new day) is the slowest, because the model reads the whole tool list
once. Later questions reuse that.

## 7. Updates

- With internet on the box: make a GitHub token once (GitHub > Settings > Developer settings > Fine-grained
  tokens > Generate; Repository access: only MY-CO-L; Permissions: **Contents: Read-only**). Put it in `.env` as
  `GITHUB_TOKEN=`. Then any time: `./mycol.sh update`.
- Without: download the newest `mycol-selfhost.tar.gz` from Releases, copy it over, `./mycol.sh update FILE`.

Update backs up first, keeps the previous app in `app.old`, swaps the new one in and applies any new database
changes. Phones pick up the new app the next time they open it.

## 8. Backups

- Every night at 02:30 (farm clock): a full database backup in `~/mycol/backups`, kept 14 days, then one a week
  for 8 weeks, then one a month for 12 months. Each has a checksum file.
- **USB drive:** plug one in, find it with `lsblk`, mount it at `/mnt/usb` (the plan has the one-time lines), and
  set `USB_DIR=/mnt/usb` in `.env`. Every backup is copied there.
- **Off-site:** install rclone (`sudo apt install rclone`), run `rclone config` and add your Google Drive, then add
  a **crypt** remote on top of it (so Google only ever sees scrambled files), and set `OFFSITE=gdrive-crypt:mycol`
  in `.env`. Keep the crypt passwords in your password manager: without them the off-site copy cannot be opened.
- Every Sunday 04:00 the box restores the newest backup into a scratch database to prove it works
  (`./mycol.sh restore-test`, result in `backups/backup.log`).
- To go back to a backup: `./mycol.sh restore backups/mycol-....dump` (it asks you to type RESTORE and backs up
  the current records first).
- `./mycol.sh status` shows what is running and the newest backup.

## 9. Power cuts

- The box, the internet router and the modem go on the UPS; the UPS goes on an outlet that is on the generator's
  emergency circuits. Set the UPS's sensitivity to **low** so it accepts generator power.
- UPS USB cable to the box, then `sudo apt install nut` and the three short NUT files in the plan: the box shuts
  itself down cleanly when the UPS battery is low, and starts again when power returns (BIOS setting, step 1).
- Everything restarts by itself (tested by pulling the plug on every part at once: the database recovered and
  nothing was lost).
- Phones keep working while the box is off: the app saves to the phone and sends the changes when the box is back
  (the offline queue).

## 10. Sensors (after construction)

Govee cloud: in the Govee Home app, **Profile > Settings > Apply for API Key** (free, arrives by email). Put it in
`.env` as `GOVEE_API_KEY=`, then `./mycol.sh start`. On the ATMOSPHERICS screen, give each Govee sensor its model
(for example H5179) and device id and tick automatic. The bridge then saves a reading for each one every 10 minutes
(source GOVEE). Bluetooth-only sensors and the Lennox units are later steps in the plan.

## Using the public GitHub Pages copy with the box

Optional. In the repository, **Settings > Secrets and variables > Actions > Variables**, set `VITE_SUPABASE_URL` to
the box's https address and `VITE_SUPABASE_KEY` to the `ANON_KEY` from the box's `.env` (it is a public key).
The next merge rebuilds the Pages site to use the box. The box allows that one other address (`PAGES_ORIGIN`
in `.env`). It still only works on devices signed in to Tailscale.

## If something is wrong

- `./mycol.sh status` and `./mycol.sh logs` (or `./mycol.sh logs auth`, `db`, `rest`, `web`, `ollama`, `bridge`)
- Nothing answers after a power cut: `./mycol.sh start`
- Forgot a passcode: `./mycol.sh passcode you@example.com`
