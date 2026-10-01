#!/usr/bin/env python3
"""EduGrade server console.

Built into the server: app.py starts it on boot and reads commands from the
server's stdin — just type `help` in the hosting panel's console.
Standalone:    python manage.py   (or: docker exec -it edugrade python manage.py)
One command:   python manage.py stats

Works directly on the data directory (SQLite read-only for statistics and
listings — only deleting a user writes, via db.py — data/announcement.json
for announcements). The running server picks up
announcement changes on its next request — no restart needed.
"""
import cmd
import json
import shlex
import sqlite3
import sys
import textwrap
import threading
from datetime import datetime, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
DB_FILE = DATA_DIR / "edugrade.db"
ANNOUNCEMENT_PATH = DATA_DIR / "announcement.json"
LEVELS = {
    "info": "Info (blau)",
    "alert": "Hinweis (gelb)",
    "danger": "Achtung (rot)",
}

# ---------- terminal helpers ----------

_COLOR = sys.stdout.isatty()


def c(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _COLOR else text


def bold(t): return c(t, "1")
def dim(t): return c(t, "2")
def green(t): return c(t, "32")
def red(t): return c(t, "31")


LEVEL_COLOR = {"info": "34", "alert": "33", "danger": "31"}


CANCEL_WORDS = ("abbrechen", "cancel")
# Inside the server (hosting panel console): panels like Pterodactyl only show
# a line once it ends with a newline, so a question waiting on the same line
# as the answer would stay invisible. Then every question gets its own line.
LINE_PROMPTS = False


def read_line(prompt: str = "") -> str:
    if sys.stdin.isatty() and not LINE_PROMPTS:
        line = input(prompt)
    else:
        if prompt:
            print(prompt, flush=True)
        line = sys.stdin.readline()
        if not line:
            raise EOFError
        line = line.rstrip("\r\n")
    if line.strip().lower() in CANCEL_WORDS:
        raise KeyboardInterrupt
    return line


def ask(prompt: str, default: str = "") -> str:
    hint = f" [{default}]" if default else ""
    try:
        value = read_line(f"  {prompt}{hint}: ").strip()
    except EOFError:
        raise KeyboardInterrupt
    return value or default


def ask_multiline(prompt: str) -> str:
    print(f"  {prompt} {dim('(mehrere Zeilen möglich, leere Zeile beendet)')}")
    lines = []
    while True:
        try:
            line = read_line("  > ")
        except EOFError:
            raise KeyboardInterrupt
        if not line.strip():
            break
        lines.append(line.rstrip())
    return "\n".join(lines).strip()


def ask_choice(prompt: str, options: dict, default: str) -> str:
    keys = list(options)
    for i, key in enumerate(keys, 1):
        print(f"    {i}) {c(options[key], LEVEL_COLOR.get(key, '0'))}")
    while True:
        raw = ask(prompt, default).lower()
        if raw in options:
            return raw
        if raw.isdigit() and 1 <= int(raw) <= len(keys):
            return keys[int(raw) - 1]
        print(red("    Bitte eine Nummer oder einen Namen aus der Liste wählen."))


def ask_yes(prompt: str, default: bool = True) -> bool:
    raw = ask(f"{prompt} (j/n)", "j" if default else "n").lower()
    return raw in ("j", "ja", "y", "yes")


def parse_until(raw: str) -> str:
    """'' | 2026-10-31 | 31.10.2026 | +7 (days) | ISO datetime → ISO string or ''."""
    raw = raw.strip()
    if not raw or raw.lower() in ("n", "nein", "no", "-", "unbegrenzt", "never"):
        return ""
    if raw.startswith("+") and raw[1:].isdigit():
        return (datetime.now() + timedelta(days=int(raw[1:]))).replace(microsecond=0).isoformat()
    for fmt in ("%d.%m.%Y %H:%M", "%d.%m.%Y"):
        try:
            parsed = datetime.strptime(raw, fmt)
            break
        except ValueError:
            parsed = None
    if parsed is None:
        parsed = datetime.fromisoformat(raw)
    if len(raw) <= 10:  # bare date = through the end of that day
        parsed = parsed.replace(hour=23, minute=59, second=59)
    return parsed.isoformat()


def fmt_until(iso: str) -> str:
    return datetime.fromisoformat(iso).strftime("%d.%m.%Y %H:%M") if iso else "unbegrenzt"


# ---------- announcements (format shared with app.py: {"announcements": [...]}) ----------

def load_announcements() -> list:
    try:
        data = json.loads(ANNOUNCEMENT_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    return data.get("announcements", []) if isinstance(data, dict) else []


def save_announcements(items: list) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    tmp = ANNOUNCEMENT_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps({"announcements": items}, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(ANNOUNCEMENT_PATH)  # atomic: the server never reads a half-written file


def is_live(a: dict) -> bool:
    if not a.get("active"):
        return False
    return not a.get("until") or datetime.now() <= datetime.fromisoformat(a["until"])


def print_announcement(a: dict, index: int | None = None) -> None:
    state = green("LIVE") if is_live(a) else dim("aus ")
    num = f"{index}) " if index is not None else ""
    level = c(LEVELS.get(a["level"], a["level"]), LEVEL_COLOR.get(a["level"], "0"))
    print(f"  {num}[{state}] {bold(a.get('title') or '(Standard-Titel)')}  {level}  {dim(a['id'])}")
    for line in a.get("message", "").split("\n"):
        print(textwrap.indent(textwrap.fill(line, 76) or "", "        "))
    if a.get("message_en"):
        print(dim(f"        EN: {a.get('title_en') or '(default title)'} — {a['message_en'][:60]}"))
    print(dim(f"        bis: {fmt_until(a.get('until', ''))}"))


# ---------- statistics ----------

def _db():
    if not DB_FILE.exists():
        raise FileNotFoundError(f"Keine Datenbank unter {DB_FILE}")
    # Read-only: the console must never interfere with the running server.
    return sqlite3.connect(f"file:{DB_FILE}?mode=ro", uri=True)


def collect_stats() -> list[tuple[str, list[tuple[str, object]]]]:
    now = datetime.now()
    iso = lambda d: (now - timedelta(days=d)).isoformat()
    with _db() as con:
        one = lambda sql, *p: con.execute(sql, p).fetchone()[0]
        users = [
            ("Gesamt", one("SELECT COUNT(*) FROM users")),
            ("Neu (7 Tage)", one("SELECT COUNT(*) FROM users WHERE json_extract(doc,'$.created_at') >= ?", iso(7))),
            ("Neu (30 Tage)", one("SELECT COUNT(*) FROM users WHERE json_extract(doc,'$.created_at') >= ?", iso(30))),
            ("Mit gekoppeltem Handy", one("SELECT COUNT(*) FROM users WHERE json_extract(doc,'$.device') IS NOT NULL")),
            ("Ohne Recovery Key", one("SELECT COUNT(*) FROM users WHERE json_extract(doc,'$.recovery_key_hash') IS NULL")),
            ("Organisations-Admins", one("SELECT COUNT(*) FROM users WHERE json_extract(doc,'$.account_type') = 'org_admin'")),
            ("Ohne Schule (Lehrer)", one("SELECT COUNT(*) FROM users WHERE TRIM(COALESCE(json_extract(doc,'$.school'),'')) = '' AND COALESCE(json_extract(doc,'$.account_type'),'teacher') <> 'org_admin'")),
        ]
        live = "expires_at > ?"
        sessions = [
            ("Aktive Sitzungen", one(f"SELECT COUNT(*) FROM sessions WHERE {live}", now.isoformat())),
            ("davon Web", one(f"SELECT COUNT(*) FROM sessions WHERE {live} AND NOT COALESCE(json_extract(doc,'$.long_session'),0)", now.isoformat())),
            ("davon App", one(f"SELECT COUNT(*) FROM sessions WHERE {live} AND COALESCE(json_extract(doc,'$.long_session'),0)", now.isoformat())),
            ("Nutzer mit aktiver Sitzung", one(f"SELECT COUNT(DISTINCT user_id) FROM sessions WHERE {live}", now.isoformat())),
        ]
        data = [
            ("Klassen", one("SELECT COUNT(*) FROM user_classes")),
            ("Ø Klassen pro Nutzer", round(one("SELECT COUNT(*) FROM user_classes") / max(1, one("SELECT COUNT(*) FROM users")), 1)),
            ("Aktive Freigaben", one("SELECT COUNT(*) FROM class_shares WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?)", now.isoformat())),
            ("Organisationen", one("SELECT COUNT(*) FROM orgs")),
            ("Org-Mitglieder (bestätigt)", one("SELECT COUNT(*) FROM org_members WHERE status = 'approved'")),
            ("Beitrittsanfragen offen", one("SELECT COUNT(*) FROM org_members WHERE status = 'pending'")),
        ]
    anns = load_announcements()
    announcements = [
        ("Live", sum(1 for a in anns if is_live(a))),
        ("Gesamt (inkl. beendet)", len(anns)),
    ]
    db_size = DB_FILE.stat().st_size / 1024 / 1024
    return [
        ("Nutzer", users),
        ("Sitzungen", sessions),
        ("Daten", data),
        ("Ankündigungen", announcements),
        ("Server", [("Datenbank", f"{db_size:.1f} MB"), ("Stand", now.strftime("%d.%m.%Y %H:%M"))]),
    ]


# ---------- users ----------

UNVERIFIED_TTL = timedelta(hours=24)   # same grace period as app.UNVERIFIED_ACCOUNT_TTL_HOURS
USERS_SHOWN = 20


def load_users(search: str = "") -> list[dict]:
    """Newest first; `search` matches email or username (substring)."""
    with _db() as con:
        rows = con.execute("""
            SELECT u.email, u.doc, m.role, m.status, o.name,
                   (SELECT COUNT(*) FROM user_classes WHERE user_id = u.id),
                   (SELECT MAX(json_extract(s.doc, '$.created_at')) FROM sessions s WHERE s.user_id = u.id)
            FROM users u
            LEFT JOIN org_members m ON m.user_id = u.id
            LEFT JOIN orgs o ON o.id = m.org_id
        """).fetchall()
    users = []
    for email, doc, role, status, org, classes, last_session in rows:
        d = json.loads(doc)
        if search and search.lower() not in f"{email} {d.get('username', '')} {d.get('school', '')}".lower():
            continue
        users.append({
            "email": email, "username": d.get("username", ""), "id": d.get("id", ""),
            "created_at": d.get("created_at", ""), "verified": d.get("email_verified") is not False,
            "type": d.get("account_type", "teacher"), "paired": bool(d.get("device")),
            "school": (d.get("school") or "").strip(),
            "org": org, "org_role": role, "org_status": status,
            "classes": classes, "last_session": last_session or "",
        })
    users.sort(key=lambda u: u["created_at"], reverse=True)
    return users


def _fmt_date(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso).strftime("%d.%m.%Y %H:%M")
    except (TypeError, ValueError):
        return "–"


def is_stale_unverified(u: dict) -> bool:
    if u["verified"]:
        return False
    try:
        return datetime.now() - datetime.fromisoformat(u["created_at"]) > UNVERIFIED_TTL
    except (TypeError, ValueError):
        return True


def print_user(u: dict, index: int | None = None) -> None:
    num = f"{index:>2}) " if index is not None else ""
    state = green("✓") if u["verified"] else red("✗ unbestätigt")
    kind = " · Org-Admin" if u["type"] == "org_admin" else ""
    print(f"  {num}{bold(u['username'])}  {u['email']}  {state}{kind}")
    details = [f"seit {_fmt_date(u['created_at'])}", f"{u['classes']} Klassen"]
    if u["school"]:
        details.insert(0, u["school"])
    if u["org"]:
        role = "Admin" if u["org_role"] == "admin" else "Lehrer"
        details.append(f"{u['org']} ({role}{', wartet' if u['org_status'] == 'pending' else ''})")
    if u["paired"]:
        details.append("Handy gekoppelt")
    details.append(f"zuletzt angemeldet {_fmt_date(u['last_session'])}" if u["last_session"] else "keine aktive Sitzung")
    print(dim(f"      {' · '.join(details)}  [{u['id']}]"))


def delete_user(u: dict) -> bool:
    """Delete through db.py (also inside the server process, so the running
    server's cached keys for the account's sessions are dropped as well)."""
    import db
    try:
        tokens = db.delete_account(u["email"])
    except ValueError:
        print(red("    Ist Admin einer Organisation mit weiteren Mitgliedern — erst Admin-Rolle übertragen."))
        return False
    server = sys.modules.get("app") or sys.modules.get("__main__")
    for tok in tokens:
        if hasattr(server, "clear_session_cache"):
            server.clear_session_cache(tok)
    return True


# ---------- schools ----------

def load_schools() -> tuple[list[tuple[str, int, list[str]]], int]:
    """Schools from the profiles, grouped case-insensitively (like db.list_schools):
    [(name, accounts, other spellings)], most accounts first — plus the number
    of teacher accounts without a school."""
    with _db() as con:
        rows = con.execute("""
            SELECT TRIM(json_extract(doc, '$.school')), COUNT(*) FROM users
            WHERE TRIM(COALESCE(json_extract(doc, '$.school'), '')) <> ''
            GROUP BY 1
        """).fetchall()
        missing = con.execute("""
            SELECT COUNT(*) FROM users
            WHERE TRIM(COALESCE(json_extract(doc, '$.school'), '')) = ''
              AND COALESCE(json_extract(doc, '$.account_type'), 'teacher') <> 'org_admin'
        """).fetchone()[0]
    groups: dict[str, list[tuple[str, int]]] = {}
    for name, n in rows:
        groups.setdefault(name.casefold(), []).append((name, n))
    schools = []
    for variants in groups.values():
        variants.sort(key=lambda v: -v[1])
        schools.append((variants[0][0], sum(n for _, n in variants), [v for v, _ in variants[1:]]))
    schools.sort(key=lambda s: (-s[1], s[0].casefold()))
    return schools, missing


# ---------- console ----------

class Console(cmd.Cmd):
    intro = (f"{bold('EduGrade Server-Konsole')}  {dim('— help zeigt alle Befehle, exit beendet')}\n")
    prompt = c("edugrade", "35") + "> "
    # True when running inside the server process (panel console): exit must
    # not stop reading commands, the server keeps running anyway.
    embedded = False

    def emptyline(self):
        pass

    def default(self, line):
        print(red(f"Unbekannter Befehl: {line.split()[0]}") + dim("  (help für die Liste)"))

    def onecmd(self, line):
        try:
            return super().onecmd(line)
        except KeyboardInterrupt:
            print(dim("\n  Abgebrochen."))
        except Exception as e:  # keep the console alive
            print(red(f"  Fehler: {e}"))

    # --- stats ---
    def do_stats(self, _arg):
        """stats — Überblick über Nutzer, Sitzungen, Daten und Ankündigungen"""
        for section, rows in collect_stats():
            print(f"\n  {bold(section)}")
            for label, value in rows:
                print(f"    {label:<30} {value}")
        print()

    # --- announce wizard ---
    def do_announce(self, _arg):
        """announce — Assistent: neue Ankündigung für alle Nutzer erstellen"""
        print(f"\n  {bold('Neue Ankündigung')} {dim('(„abbrechen“ bricht jederzeit ab)')}\n")
        print("  Typ:")
        level = ask_choice("Typ", LEVELS, "info")
        title = ask("Titel (leer = Standard je nach Typ)")
        message = ""
        while not message:
            message = ask_multiline("Text:")
            if not message:
                print(red("    Der Text darf nicht leer sein."))
        title_en = message_en = ""
        if ask_yes("Englische Version für nicht-deutsche Nutzer hinzufügen?", default=False):
            title_en = ask("Titel (EN, leer = Standard)")
            message_en = ask_multiline("Text (EN):")
        until = None
        while until is None:
            raw = ask("Anzeigen bis (z. B. 31.10.2026, +7 für 7 Tage, leer oder n = unbegrenzt)")
            try:
                until = parse_until(raw)
            except ValueError:
                print(red("    Ungültiges Datum."))

        now = datetime.now()
        items = load_announcements()
        ann_id = now.strftime("%Y%m%d-%H%M%S")
        while any(a["id"] == ann_id for a in items):
            ann_id += "b"
        ann = {
            "id": ann_id, "active": True, "level": level,
            "title": title, "message": message,
            "title_en": title_en, "message_en": message_en,
            "until": until, "created_at": now.isoformat(timespec="seconds"),
        }
        print(f"\n  {bold('Vorschau')}")
        print_announcement(ann)
        print()
        if not ask_yes("Jetzt veröffentlichen?"):
            print(dim("  Nicht veröffentlicht."))
            return
        items.append(ann)
        save_announcements(items)
        live = sum(1 for a in items if is_live(a))
        print(green(f"  ✓ Veröffentlicht ({ann_id}).") +
              f" {live} Ankündigung(en) live — Nutzer sehen sie nacheinander, ältere zuerst.\n")

    # --- list / stop ---
    def do_announcements(self, arg):
        """announcements [all] — aktive Ankündigungen anzeigen (all: auch beendete)"""
        items = load_announcements()
        shown = items if arg.strip() == "all" else [a for a in items if is_live(a)]
        if not shown:
            print(dim("  Keine " + ("" if arg.strip() == "all" else "aktiven ") + "Ankündigungen."))
            return
        print()
        for i, a in enumerate(shown, 1):
            print_announcement(a, i)
        print()

    def do_unannounce(self, arg):
        """unannounce [nummer|id|all] — Ankündigung beenden (ohne Angabe: Auswahl)"""
        items = load_announcements()
        live = [a for a in items if is_live(a)]
        if not live:
            print(dim("  Keine aktiven Ankündigungen."))
            return
        choice = arg.strip()
        if not choice:
            print()
            for i, a in enumerate(live, 1):
                print_announcement(a, i)
            print()
            choice = ask("Welche beenden? (Nummer, 'all' oder leer = abbrechen)")
            if not choice:
                print(dim("  Abgebrochen."))
                return
        if choice == "all":
            hits = live
        elif choice.isdigit() and 1 <= int(choice) <= len(live):
            hits = [live[int(choice) - 1]]
        else:
            hits = [a for a in live if a["id"] == choice]
        if not hits:
            print(red(f"  Nicht gefunden: {choice}"))
            return
        if not ask_yes(f"{len(hits)} Ankündigung(en) beenden?"):
            print(dim("  Abgebrochen."))
            return
        for a in hits:
            a["active"] = False
        save_announcements(items)
        print(green(f"  ✓ Beendet: {', '.join(a['id'] for a in hits)}"))

    def complete_unannounce(self, text, *_):
        return [x for x in ["all"] + [a["id"] for a in load_announcements() if is_live(a)] if x.startswith(text)]

    # --- users ---
    def do_users(self, arg):
        """users [suche] — neueste Konten anzeigen (Suche: E-Mail, Name, Schule), einzelne oder alle unbestätigten löschen"""
        search = arg.strip()
        while True:
            users = load_users(search)
            shown = users[:USERS_SHOWN]
            stale = [u for u in users if is_stale_unverified(u)]
            if not shown:
                print(dim(f"  Keine Konten{' für „' + search + '“' if search else ''}."))
                return
            print(f"\n  {bold('Konten')} {dim(f'— {len(users)} gesamt, neueste zuerst' + (f', Suche „{search}“' if search else ''))}\n")
            for i, u in enumerate(shown, 1):
                print_user(u, i)
            if len(users) > len(shown):
                print(dim(f"\n  … und {len(users) - len(shown)} weitere (users <suche> grenzt ein)"))
            print()
            options = "Nummer = Konto löschen"
            if stale:
                options += f", 'unbestätigt' = {len(stale)} unbestätigte (älter als 24 h) löschen"
            choice = ask(f"Aktion ({options}, leer = fertig)").lower()
            if not choice:
                return
            if choice in ("unbestätigt", "unbestaetigt", "u") and stale:
                if ask_yes(f"{len(stale)} unbestätigte Konten endgültig löschen?", default=False):
                    done = sum(delete_user(u) for u in stale)
                    print(green(f"  ✓ {done} Konto/Konten gelöscht."))
                continue
            if not (choice.isdigit() and 1 <= int(choice) <= len(shown)):
                print(red(f"  Ungültige Auswahl: {choice}"))
                continue
            u = shown[int(choice) - 1]
            print()
            print_user(u)
            print(red("\n  Löscht das Konto mit allen Klassen und Noten endgültig — das lässt sich nicht rückgängig machen."))
            if ask("Zur Bestätigung die E-Mail-Adresse eintippen").lower() != u["email"]:
                print(dim("  Stimmt nicht überein — nichts gelöscht."))
                continue
            if delete_user(u):
                print(green(f"  ✓ {u['email']} gelöscht."))

    # --- schools ---
    def do_schools(self, arg):
        """schools [suche] — eingetragene Schulen mit Anzahl der Konten (Konten dazu: users <schule>)"""
        search = arg.strip().casefold()
        schools, missing = load_schools()
        if search:
            schools = [s for s in schools if search in s[0].casefold()]
        if not schools:
            print(dim(f"  Keine Schulen{' für „' + arg.strip() + '“' if search else ''}."))
        else:
            total = sum(n for _, n, _ in schools)
            print(f"\n  {bold('Schulen')} {dim(f'— {len(schools)} Schule(n), {total} Konto/Konten' + (f', Suche „{arg.strip()}“' if search else ''))}\n")
            width = max(len(name) for name, _, _ in schools)
            for name, n, variants in schools:
                extra = dim(f"  auch: {', '.join(variants)}") if variants else ""
                print(f"    {name:<{width}}  {n:>4}{extra}")
        if not search:
            print(dim(f"\n  {missing} Lehrer-Konto/Konten noch ohne Schule — werden beim nächsten Login danach gefragt."))
        print()

    # --- misc ---
    def do_exit(self, _arg):
        """exit — Konsole beenden"""
        if self.embedded:
            print(dim("  Die Konsole gehört zum Server und bleibt aktiv. Server stoppen: über das Panel."))
            return False
        return True

    do_quit = do_exit

    def do_EOF(self, _arg):
        print()
        return True

    def do_help(self, arg):
        """help [befehl] — Hilfe anzeigen"""
        if arg:
            return super().do_help(arg)
        print()
        for name in ("stats", "users", "schools", "announce", "announcements", "unannounce", "exit"):
            doc = getattr(self, f"do_{name}").__doc__ or ""
            usage, _, text = doc.partition(" — ")
            print(f"  {bold(usage):<40} {text}")
        print()


def start_in_server() -> None:
    """Run the console in a background thread of the server process, reading
    the server's stdin (hosting panel console). No-op without usable stdin."""
    if getattr(start_in_server, "started", False):
        return
    start_in_server.started = True
    if sys.stdin is None or sys.stdin.closed:
        return
    global LINE_PROMPTS
    LINE_PROMPTS = True
    try:
        sys.stdout.reconfigure(line_buffering=True)  # panel output immediately, not in 8 KB blocks
    except Exception:
        pass

    def serve():
        console = Console()
        console.embedded = True
        # No inline "edugrade> " prompt: the panel wouldn't show it (no newline);
        # the typed command is echoed by the panel/terminal anyway.
        console.use_rawinput = False
        console.prompt = ""
        console.intro = "EduGrade Server-Konsole bereit — „help“ zeigt alle Befehle."
        try:
            console.cmdloop()
        except Exception as e:
            print(f"Server-Konsole beendet: {e}", flush=True)

    threading.Thread(target=serve, name="server-console", daemon=True).start()


def main() -> int:
    console = Console()
    if len(sys.argv) > 1:
        console.onecmd(shlex.join(sys.argv[1:]))
        return 0
    try:
        console.cmdloop()
    except KeyboardInterrupt:
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
