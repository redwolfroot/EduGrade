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
- **Zero-Knowledge** - Server admins cannot read user data without the password
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
curl -O https://raw.githubusercontent.com/rwolf2467/EduGrade/main/docker-compose.yml

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
git clone https://github.com/rwolf2467/edugrade.git
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

Report vulnerabilities via [GitHub Issues](https://github.com/rwolf2467/EduGrade/issues).