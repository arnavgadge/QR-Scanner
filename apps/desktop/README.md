# VICIMUS Serial Station (desktop)

The serial scanning app as a Windows desktop application for an office network: **one main computer
(server)** keeps all records; **stations (nodes)** register serials and print labels. Nobody types
an IP address: stations find the main computer by itself on the Wi-Fi.

This is a separate product from the phone companion app (`android-scanner/`, "Serial Scanner"),
which only types serials into a station over Bluetooth. The server never talks to phones.

Daily requirement: all computers on the same office Wi-Fi, and the main computer switched on.

## Install and first start

1. Run `VICIMUS-Serial-Station-Setup-<version>.exe` on every computer (Windows 10/11, x64). It asks
   for administrator permission once, because it:
   - adds a Windows Firewall rule for the app (private and domain networks), and
   - changes the networks the computer is connected to **right now** from Public to Private if
     Windows marked them Public (Public blocks discovery between the computers).
2. First start asks: **Main computer** or **Station**.
   - **Main computer** (choose on ONE computer only): create the administrator account. From then
     on it starts with Windows and keeps running in the system tray (closing the window hides it).
   - **Station**: it searches for the main computer. On the main computer, an administrator opens
     **Admin › Stations › Add station**, which shows a 6-digit code (changes every 30 s, works once).
     Type it on the station.
3. **One-time station setup** (every station, including the main computer's own scan screen):
   the station's name (required, e.g. "Station 2") and its usual operator's name (optional). No
   password. From then on the station opens straight to the scan screen, after every restart too,
   and never asks anyone to sign in.
4. On each station choose the label printer once: **This computer › Label printer**.

Records and the duplicate screen show the station, its operator (if set) and the main computer's
time, e.g. "Registered on Station 2 (Ravi) at 10:42, 11 Oct". An administrator can rename a station
or change its operator in **Admin › Stations** (new records use the new name; existing records keep
what they were stored with).

All computers must run the same app version; a station with a different version shows "Update
needed" and cannot register.

## Where the data is

| What                        | Where (Windows)                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Database (single file)**  | `%APPDATA%\VICIMUS Serial Station\server\serials.db` on the main computer (SQLite, WAL mode: `serials.db-wal` / `-shm` next to it are part of it while running)    |
| Server certificate          | same folder: `server-cert.pem`, `server-key.pem`                                                                                                                   |
| Backup main computer's copy | the same path on the backup station: `…\server\serials.db` and its own `server-cert.pem` / `server-key.pem` (erased when the backup role moves to another station) |
| This computer's settings    | `%APPDATA%\VICIMUS Serial Station\config.json` (mode, station name, printer; the station credential is encrypted with Windows DPAPI)                               |

The exact database path is also shown in **Admin › Stations › Advanced**. Each computer keeps its
data in this one file. Scheduled backup files are not part of this version.

The **admin password recovery code** is shown once when the main computer is set up (and after
each use, and under Admin › Stations › Make a new recovery code). Only its scrypt hash is stored;
it is copied to the backup, so a forgotten password can be reset on the main computer (sign-in ›
Forgot password?) or used on the backup to promote it.

## How it works

- **Data**: only the main computer has a database. Each serial is unique per company
  (`UNIQUE(company_id, serial)`); registration is one atomic transaction, so two stations sending
  the same serial at the same moment get exactly one "new" and one "duplicate". Every attempt is
  logged with operator, station name and the main computer's timestamp.
- **Discovery**: the main computer announces itself with mDNS (`_vicimus-station._tcp`) and a
  permanent server ID; stations follow that ID, so a changed IP address is picked up within
  seconds. Addresses appear only in the Advanced sections.
- **Pairing**: SRP-6a (RFC 5054, as used by Apple HomeKit pairing) with the 6-digit code as the
  password; the code is never sent. 5 wrong codes lock pairing for 5 minutes. Pairing gives the
  station its own credential (stored on the server only as a SHA-256 hash) and the server's
  certificate.
- **Encryption**: all station-server traffic is TLS, pinned to the server's certificate. Removing a
  station (Admin › Stations) locks it out immediately.
- **Who is registering**: the paired station itself is the identity: scanning needs no sign-in, only
  the station's credential. An unpaired or removed station cannot register.
- **Admin sign-in**: only administrators sign in, and only for the admin pages; passwords are stored
  as scrypt hashes. An admin sign-in ends after 15 minutes without activity (configurable in Admin ›
  Stations, 1–240 minutes). The server enforces it on every request.
- **No server, no registration**: when the main computer is unreachable, stations show "Server
  unreachable, can't register", refuse to register (no local queue) and keep retrying.
- **Offline**: the app makes no internet requests. Every asset is bundled; the page may only load
  its own files (enforced in the app and by a Content-Security-Policy).
- **Find and reprint**: Admin › Find serial looks up any serial (station or Excel import).
  Reprints need an administrator sign-in, print on that station's printer, and are logged in Scan
  History as "Reprint". Imported serials appear in Scan History as "Imported"; each import's rows
  (added / skipped / conflicts) open from Import history.
- **Printing**: labels print silently (no dialog, no headers/footers) on the station's printer, at
  the company's label size (Admin › Companies › Label size; empty = 70 × 35 mm).

## One main computer per network

- **Setting up a main computer** first listens on the network for 4 s. If a main computer is
  already announcing itself, setup is refused: "A main computer already exists on this network
  (name). Set this PC up as a station instead, or use the backup if you're replacing it."
- **A new station** that finds more than one main computer never picks one: it lists them by
  computer name and asks an administrator to choose.
- **Every main computer** keeps watching the network. A main computer of a _different_ system
  (another server ID) is shown as a warning to administrators on both. A promoted backup, or a
  former main computer of the same system, has the same server ID and never triggers it; a former
  main computer also stops announcing itself once it retires.

## Backup main computer and promotion

- **Choosing the backup** (Admin › Stations › Backup main computer): exactly one station. It
  keeps a live copy of everything (serials, scan log, imports, companies, users, stations,
  settings; not sign-ins). Moving the role erases the previous backup's copy.
- **Copying**: SQLite triggers record every change in `repl_log` in the same transaction as the
  change. The backup receives a full copy, then each change, over its pinned TLS connection, and
  confirms. Before a station shows "new", the main computer waits up to 2 s for the backup's
  confirmation when the backup is connected. If it is not, registering continues and the admin
  pages show "Backup computer offline. Data isn't being copied."
- **Network-split rule** (exact): the main computer registers (scans, imports) only if
  1. no backup is set, or
  2. the backup is connected, or
  3. more than half of the _other_ stations are connected (all paired stations except the main
     computer itself and the backup; with no other stations, rule 3 never holds, so the backup is
     required).

  "Connected" = a live connection that has lasted at least 15 s and answered within the last 15 s
  (heartbeat every 5 s). A main computer also waits 15 s after starting or being promoted. A
  station only keeps a live connection to the main computer of the highest term it knows, so no
  station or backup can count for two main computers at the same time, and two main computers can
  never both register. Otherwise: "Can't reach the other computers. Scanning is paused so no serial
  is registered twice."

- **Promotion** (on the backup: This computer › Make this the main computer): the admin password
  (or the recovery code plus a new password). If the main computer is reachable it steps down
  first and hands over every change (planned switch). If not, the screen shows "Last copied at
  …" and requires "I understand recent serials may be missing". Each promotion raises the term.
  The new main computer then asks for a new backup.
- **Stations switch on their own**: the main computer shares the backup's certificate with every
  station in advance. Stations pin both, follow the highest term, and send it with every request.
- **Former main computer**: when it hears of a higher term (from a station, or by finding its
  promoted backup on the network) it retires: it never registers again and shows "This computer
  is no longer the main computer". An admin confirms with their password; it sends the new main
  computer the serials, scans and imports written after the backup's last confirmation (serials
  with different details are listed under Admin › Stations), then becomes a station with its
  existing pairing and its old database is removed.

## Develop, test, build

The desktop app's screens are the React app in `apps/web` built in "desktop" mode, and the main
process reuses its pure modules (services, translations, types). So install `apps/web` first.

```
cd apps/web && npm install && cd ../desktop
npm install
npm test                 # all desktop tests, run INSIDE Electron's runtime (its TLS library)
npm test -- --node       # the same under plain Node
npm run typecheck
npm run lint             # the web app's lint rules (uses apps/web's ESLint)
npm run format:check
npm start                # builds the page (vite --mode desktop) + main process, opens the app
npm run dist:win         # builds, checks the bundle, makes dist/VICIMUS-Serial-Station-Setup-<v>.exe
```

`npm run verify:bundle` fails if Firebase or any remote asset ends up in the desktop build.

**Terminal log.** The app writes what it does to the terminal it was started from: the settings
folder and profile, server startup (database file, certificate fingerprint and whether it was
created/loaded/replaced, listening port, mDNS announcement and addresses, mDNS errors) and every
station connection failure with its reason (e.g. `ECONNREFUSED`, a TLS error code, a timeout,
"update-required"). Identical repeated failures are collapsed. `VICIMUS_LOG=silent` turns it off.

**Upgrading from 1.0.0 builds made before 2026-10-11:** those created a server certificate that
Electron could not verify, so the main computer's own window and every station showed "Can't
reach the main computer". The server now replaces such a certificate on start (logged); the main
computer's window adopts it automatically, and any station paired before must be paired again.

Running a main computer and a station on ONE PC (testing only): start the app twice with different
profiles, e.g. `VICIMUS_PROFILE=server npm run start:built` and `VICIMUS_PROFILE=station1 npm run
start:built` (PowerShell: `$env:VICIMUS_PROFILE="server"; npm run start:built`).

Installers built on macOS are not code-signed and the `.exe` keeps Electron's default file icon
(the shortcut/installer icon is set). Build on Windows with a code-signing certificate for
distribution, otherwise Windows SmartScreen warns on first run.
