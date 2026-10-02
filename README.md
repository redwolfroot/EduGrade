# EduGrade

[![Docker Hub](https://img.shields.io/badge/docker-redwolf2467%2Fedugrade-blue?logo=docker)](https://hub.docker.com/r/redwolf2467/edugrade)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Uptime Status](https://status.avocloud.net/api/badge/29/uptime)](https://status.avocloud.net)

A secure web application for teachers to manage student grades, classes, and performance tracking. Built with Python (Quart) and JavaScript.

## Screenshots

### Desktop

<img width="2560" height="1485" alt="image" src="https://github.com/user-attachments/assets/e034c086-a47c-45e6-831f-159aa705f2d6" />
<img width="2560" height="1485" alt="image" src="https://github.com/user-attachments/assets/6b1e1e72-a04e-4214-af0e-9163e10e7dbd" />
<img width="2560" height="1485" alt="image" src="https://github.com/user-attachments/assets/61a75740-ecb7-41ca-bca7-6deffde63f15" />
<img width="2560" height="1485" alt="image" src="https://github.com/user-attachments/assets/72cc2931-e04b-4083-b01f-9f2c9143a0cd" />

### Mobile

<img width="391" height="844" alt="image" src="https://github.com/user-attachments/assets/9ad02cb3-a65c-4cac-9bff-8522759f2010" />
<img width="391" height="844" alt="image" src="https://github.com/user-attachments/assets/7fd7f65f-0a74-4a0f-b548-81e89360ab79" />
<img width="391" height="844" alt="image" src="https://github.com/user-attachments/assets/94ab0cd8-f65f-453a-b51b-8265103d2a68" />
<img width="391" height="844" alt="image" src="https://github.com/user-attachments/assets/134af75a-887b-4297-ac23-1b2f90113d7b" />
<img width="391" height="844" alt="image" src="https://github.com/user-attachments/assets/74d0f382-71f7-4bf3-aac0-100400229219" />

## Features

- **Class & Student Management** - Create classes, add students, track individual performance
- **Subject-Based Organization** - Divide classes into multiple subjects (default subject can be renamed, e.g., "Math")
- **Grade Tracking** - Record grades with customizable categories, weights, and percentage-based +/~/- systems
- **Student Import** - Import student lists via CSV or JSON for quick class setup
- **Analytics & Charts** - Visual charts and detailed statistics for student performance
- **PDF Export** - Download and print detailed student views with grades and charts
- **Grade Sharing with Students** - Securely share grades with students using PIN-protected access links with expiration dates
- **Customizable Categories** - Define grade categories with custom weights and names
- **Plus/Minus Grade System** - Configurable percentage-based grading system with plus, neutral, and minus values
- **Participation Tracking** - Track and record student participation grades
- **Behavior Log** - Record student behavior per subject with date, time, type (positive/neutral/negative) and a description
- **Attendance Management** - Track student attendance (present, late, absent) with detailed statistics and history
- **Automatic Attendance Warnings** - Teachers are automatically warned when students approach or fall below the minimum attendance requirement
- **Auto-Grading for Attendance** - Optionally assign failing grades to students with critically low attendance
- **Grade Percentage Ranges** - Customizable percentage-to-grade mapping
- **Data Export/Import** - Backup and restore data in JSON format
- **Dark/Light Mode** - Comfortable viewing in any environment
- **Responsive Design** - Works on desktop, tablet, and mobile
- **Tutorial System** - Guided onboarding for new users

## Security

- **AES-256-GCM Encryption** - All user data encrypted at rest with password-derived keys
- **Encrypted Grade Shares** - Shared grade data is encrypted using a master key
- **PBKDF2 Key Derivation** - 200k iterations for password hashing, 100k for encryption keys
- **1-Hour Sessions** - Short-lived sessions with automatic cleanup
- **Encrypted at rest** - Stored gradebook data cannot be decrypted without an active session, the password, the recovery key or the paired phone (the server briefly holds the key in memory while you are signed in)
- **PIN-Protected Access** - Student grade access secured with 6-digit PINs
- **Smart Caching** - In-memory cache with heartbeat system for performance
- **Automatic Share Cleanup** - Expired and revoked shares are automatically removed

## Tech Stack

| Component | Technology                                |
|-----------|-------------------------------------------|
| Backend   | Python 3.8+, Quart (async)                |
| Frontend  | HTML5, JavaScript, Tailwind CSS, Basecoat |
| Storage   | JSON files with AES-256-GCM encryption    |
| Charts    | Chart.js                                  |

## Quick Start

### 🐳 Docker (Recommended)

The easiest way to run EduGrade:

```bash
# Pull the latest image
docker pull redwolf2467/edugrade

# Run container (accessible at http://localhost:8080)
docker run -d \
  --name edugrade \
  -p 8080:1601 \
  -v edugrade-data:/app/data \
  --restart unless-stopped \
  redwolf2467/edugrade:latest
```

**Done!** Open `http://localhost:8080` in your browser.

#### Docker Compose

```bash
# Download docker-compose.yml
curl -O https://raw.githubusercontent.com/redwolfroot/EduGrade/main/docker-compose.yml

# Edit ports if needed (default: 1601:1601, change to 8080:1601 for external port 8080)
nano docker-compose.yml

# Start
docker-compose up -d
```

See [DOCKER.md](DOCKER.md) for more Docker options and production setup.

---

### 🐍 Manual Installation

```bash
# Clone and install
git clone https://github.com/redwolfroot/edugrade.git
cd edugrade
pip install -r requirements.txt

# Run
python app.py
```

Open `http://localhost:1601` in your browser.

#### Virtual Environment (Recommended)

```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate     # Windows
pip install -r requirements.txt
```

## Project Structure

```
edugrade/
├── app.py              # Main application, routes, auth, encryption
├── requirements.txt    # Python dependencies
├── static/
│   ├── css/            # Styles
│   ├── i18n/           # Internationalization files
│   ├── logo.svg        # Logo files
│   └── scripts/        # JavaScript modules
├── templates/
│   ├── index.html      # Main dashboard
│   ├── login.html      # Authentication page
│   └── student_grades.html # Student grade view
└── data/
    └── edugrade.json   # Encrypted user data (auto-created)
```

## Configuration

Edit `app.py` to customize:

| Setting          | Default | Description               |
|------------------|---------|---------------------------|
| Port             | 1601    | Server port               |
| Session Duration | 1 hour  | Login timeout             |
| Debug Mode       | True    | Enable for development    |
| Rate Limits      | Various | Configurable per endpoint |

For production, change `app.secret_key` to a secure random string.

## Production Deployment

1. Set `debug=False` in `app.run()`
2. Use HTTPS via reverse proxy (Nginx/Apache)
3. Set `secure=True` for cookies
4. Configure proper environment variables
5. Set up logging and monitoring

## Server Console

The server has a built-in operator console: it reads commands from its own stdin, so in a hosting panel (e.g. Pterodactyl) just type `help` into the server console. Without a panel, run it separately:

```bash
docker exec -it edugrade python manage.py
```

| Command | What it does |
|---|---|
| `stats` | Users, sessions (web/app), paired phones, classes, shares, organisations |
| `announce` | Wizard for a new announcement: type (info / alert / danger), title, text, optional English version, end date |
| `announcements [all]` | List live (or all) announcements |
| `unannounce [nr\|id\|all]` | End an announcement |
| `backup` | Create an encrypted database backup now (needs `BACKUP_KEY`) |
| `restore [file]` | List backups, or restore one (server must be stopped, see below) |

Announcements appear as a dialog after login (web) or when the app is opened. Several are shown one after another, oldest first; each user sees each one until they press **OK** (on any device). Changes take effect immediately, no restart needed. Type `abbrechen` to cancel the wizard. Single commands also work non-interactively, e.g. `python manage.py stats`.

## Backups and Restore

The server writes an encrypted backup of the SQLite database once a day (first cleanup tick after midnight UTC) to `/app/backups` (volume `edugrade-backups` in `docker-compose.yml`).

- The copy is taken with SQLite's online backup API, so it is consistent while the server runs. It is encrypted in memory with AES-256-GCM (key derived with scrypt from `BACKUP_KEY` and a random per-file salt); no plaintext copy is written to disk.
- **`BACKUP_KEY` must be set** (e.g. in a `.env` file next to `docker-compose.yml`: `BACKUP_KEY=<long random secret>`). Without it no backup is made and a warning is logged. Keep the key outside the data volume and store it safely: without it a backup cannot be restored.
- Files are named `edugrade-YYYY-MM-DD_HHMMSS.db.enc` and deleted automatically after **30 days**. This matches the retention promised in the privacy policy and the DPA.
- A backup on the same server does not protect against losing the server. Copy `/app/backups` off-site (host cron job with rclone/WebDAV or similar); the encrypted files are safe to transfer.
- Manual backup: `docker exec -it edugrade python manage.py backup`.

### Restore

The server must be stopped, otherwise the database is in use.

```bash
docker compose stop edugrade
docker compose run --rm -it edugrade python manage.py restore            # lists the backups
docker compose run --rm -it edugrade python manage.py restore edugrade-2026-10-02_031500.db.enc
docker compose up -d edugrade
```

The command decrypts the file, checks it with `PRAGMA integrity_check` and only then replaces `data/edugrade.db`. The previous database stays next to it as `edugrade.db.before-restore-<timestamp>`; delete it once the restored system works. `BACKUP_KEY` must be set for the `run` command as well (compose passes it through). Test a restore regularly (at least once a year) and note the date.

## Betrieb: Log-Aufbewahrung

Server logs must not be kept longer than 30 days (privacy policy, section 10).

- The app logs no IP addresses and e-mail addresses only through `_scrub_email`; Hypercorn writes no access log (the `Dockerfile` has no `--access-logfile`). Keep it that way.
- `docker-compose.yml` deliberately has **no** `logging:` block: it would override the host's journald driver, and `json-file`/`local` limit size, not age.
- **Host requirement:** Docker uses the `journald` log driver and journald keeps logs at most 30 days (`/etc/systemd/journald.conf.d/retention.conf` with `MaxRetentionSec=30day`). After changing the driver, recreate the stack with `docker compose up -d --force-recreate`; run `journalctl --vacuum-time=30d` once.
  - **Add** `"log-driver": "journald"` to an existing `/etc/docker/daemon.json`; never overwrite the file (it may already hold `ipv6` and other settings). Create it only if it does not exist.
  - **Pterodactyl:** the game servers' container logs follow `docker.log_config` in `/etc/pterodactyl/config.yml`, not `daemon.json`. After `systemctl restart docker`, run `systemctl restart wings` and start the servers again from the panel.
- **Reverse proxy (Nginx Proxy Manager):** its own nginx logs are rotated by a custom logrotate file with `rotate 3` and `weekly` (oldest log at most 28 days), mounted as `- /opt/npm/logrotate-npm:/etc/logrotate.d/nginx-proxy-manager`. **Do not mount it with `:ro`:** NPM runs `chmod` on that file at start; with `:ro` the start fails (`s6-rc: unable to start service prepare`), the container still shows "Up" but ports 80/443 stay closed.

## Student Access & Sharing

Teachers can create secure grade shares for students:

1. Select a class and subject to share
2. Set expiration time (1 hour to 30 days)
3. Configure visibility options (grades, averages, final grades, charts, etc.)
4. Generate unique PINs for each student (6-digit)
5. Students access their grades using the share link and their personal PIN

Students can view:

- Individual grades with color-coded badges
- Category breakdowns
- Class averages
- Performance charts
- Subject information
- Teacher name

## Attendance Management

EduGrade includes a comprehensive attendance tracking system to help teachers monitor student participation:

### Features

- **Track Attendance Status** - Mark students as present, late, or absent for each session
- **Attendance Statistics** - View detailed statistics including total sessions, present/late/absent counts, and attendance rate
- **Automatic Warnings** - Visual warnings in the student list when attendance drops near or below the minimum threshold
- **Color-Coded Alerts**:
  - 🟠 **Orange Warning**: Student is approaching the minimum attendance (within warning threshold)
  - 🔴 **Red Critical**: Student has reached or fallen below the minimum attendance requirement
- **Customizable Settings**:
  - **Minimum Attendance (%)**: Set the minimum required attendance percentage (e.g., 75%)
  - **Warning Threshold (%)**: Define how close to the limit a warning should appear (e.g., 5%)
  - **Auto-Grading**: Optionally assign failing grades to students with critically low attendance
- **Attendance History** - View complete attendance history for each student with dates and notes
- **Bulk Entry** - Quickly record attendance for all students at once

### How It Works

1. Go to **Settings → Attendance** to configure thresholds
2. Enable auto-grading if students should receive failing grades for low attendance
3. Click **Attendance** button to record attendance for a session
4. Select date and mark each student's status (present/late/absent)
5. Add optional notes for absences or late arrivals
6. Students at risk are automatically highlighted in the student list
7. View detailed attendance stats in the student detail view

### Example Configuration

- **Minimum Attendance**: 75% (students must attend at least 75% of sessions)
- **Warning Threshold**: 5% (warn when student is within 5% of the limit, i.e., at 80%)
- **Auto-Grading**: Enabled (students below 75% automatically receive a failing grade)

## Detailed Student View

Click on any student to view:

- Complete grade history with charts
- Category-wise performance breakdown
- Statistical analysis and trends
- Export to PDF for printing or archiving
- Visual performance indicators

## License

**EduGrade** - Copyright (C) 2026 Fabian Murauer

Licensed under the [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html).

- Use, study, modify, and share freely
- Modified versions must provide source code
- Credit the original author
- Cannot be made proprietary

## Security Reporting

Report vulnerabilities via [GitHub Issues](https://github.com/redwolfroot/EduGrade/issues).