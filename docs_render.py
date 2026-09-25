# EduGrade - In-app documentation renderer
# Renders the Markdown docs (formerly served via Docusaurus) directly inside
# the Quart app. No Node/Docusaurus runtime required.

import re
import functools
from pathlib import Path

import markdown

DOCS_DIR = Path(__file__).parent / 'docs'

# Navigation: ordered categories -> ordered page slugs.
# Mirrors the old Docusaurus sidebars.js. Titles are read from each file's
# front matter at render time (see _page_title).
NAV = [
    (None, ['intro']),
    ('Erste Schritte', [
        'erste-schritte/registrierung',
        'erste-schritte/anmeldung',
        'erste-schritte/wiederherstellungsschluessel',
        'erste-schritte/profil-einrichten',
        'erste-schritte/tutorial',
    ]),
    ('Klassen', [
        'klassen/klasse-erstellen',
        'klassen/klasse-bearbeiten',
        'klassen/klasse-loeschen',
        'klassen/schuljahre',
    ]),
    ('Fächer', [
        'faecher/fach-hinzufuegen',
        'faecher/fach-bearbeiten',
        'faecher/standardfaecher',
        'faecher/fach-loeschen',
    ]),
    ('Schüler', [
        'schueler/schueler-hinzufuegen',
        'schueler/schueler-importieren',
        'schueler/schueler-bearbeiten',
        'schueler/schueler-loeschen',
    ]),
    ('Noten', [
        'noten/note-hinzufuegen',
        'noten/note-bearbeiten',
        'noten/notenkategorien',
        'noten/gewichtung',
        'noten/plus-minus',
        'noten/notenbereiche',
        'noten/notenberechnung',
    ]),
    ('Anwesenheit', [
        'anwesenheit/anwesenheit-erfassen',
        'anwesenheit/anwesenheit-statistiken',
        'anwesenheit/anwesenheit-einstellungen',
    ]),
    ('Schüleransicht', [
        'schueleransicht/detailansicht',
        'schueleransicht/diagramme',
        'schueleransicht/drucken',
    ]),
    ('Noten teilen', [
        'teilen/zugangslink-erstellen',
        'teilen/pins-verwalten',
        'teilen/qr-code',
        'teilen/zugang-widerrufen',
    ]),
    ('Daten', [
        'daten/export',
        'daten/import',
        'daten/sicherung',
    ]),
    ('Einstellungen', [
        'einstellungen/profil',
        'einstellungen/design',
        'einstellungen/sprache',
        'einstellungen/konto',
    ]),
]

# Flat, ordered list of all slugs (for prev/next navigation).
FLAT_SLUGS = [slug for _, slugs in NAV for slug in slugs]

# Default admonition titles (Docusaurus :::type blocks).
_ADMONITION_TITLES = {
    'note': 'Hinweis',
    'tip': 'Tipp',
    'info': 'Info',
    'warning': 'Achtung',
    'danger': 'Wichtig',
    'caution': 'Vorsicht',
}

_FRONTMATTER_RE = re.compile(r'^---\n(.*?)\n---\n?', re.S)
_ADMONITION_RE = re.compile(
    r'^:::(\w+)(?:[ \t]+(.*))?\n(.*?)\n?:::[ \t]*$',
    re.S | re.M,
)


_DOCS_ROOT = DOCS_DIR.resolve()


def _doc_path(slug: str) -> Path | None:
    """Resolve a slug to its .md path, or None if it escapes DOCS_DIR.

    Blocks path traversal (e.g. '../README'): the resolved path must stay
    inside DOCS_DIR.
    """
    p = (DOCS_DIR / f'{slug}.md').resolve()
    if p == _DOCS_ROOT or _DOCS_ROOT not in p.parents:
        return None
    return p


def _slug_exists(slug: str) -> bool:
    p = _doc_path(slug)
    return p is not None and p.is_file()


def _raw(slug: str) -> str:
    p = _doc_path(slug)
    if p is None:
        raise FileNotFoundError(slug)
    return p.read_text(encoding='utf-8')


def _split_frontmatter(text: str):
    """Return (frontmatter_dict, body)."""
    fm = {}
    m = _FRONTMATTER_RE.match(text)
    if m:
        for line in m.group(1).splitlines():
            if ':' in line:
                k, _, v = line.partition(':')
                fm[k.strip()] = v.strip().strip('"\'')
        text = text[m.end():]
    return fm, text


@functools.lru_cache(maxsize=256)
def _page_title(slug: str) -> str:
    if not _slug_exists(slug):
        return slug
    fm, _ = _split_frontmatter(_raw(slug))
    if fm.get('title'):
        return fm['title']
    # Fallback: derive from slug.
    return slug.rsplit('/', 1)[-1].replace('-', ' ').title()


def _convert_admonitions(body: str) -> str:
    """Convert Docusaurus :::type blocks into md_in_html admonition divs."""
    def repl(m):
        kind = m.group(1).lower()
        title = (m.group(2) or '').strip() or _ADMONITION_TITLES.get(kind, kind.title())
        inner = m.group(3)
        css = kind if kind in _ADMONITION_TITLES else 'note'
        return (
            f'<div class="admonition admonition-{css}" markdown="1">\n'
            f'<p class="admonition-title">{title}</p>\n\n'
            f'{inner}\n\n</div>'
        )
    return _ADMONITION_RE.sub(repl, body)


def _resolve_link(href: str, current_slug: str) -> str:
    """Rewrite a relative .md link to an in-app /docs/ URL."""
    frag = ''
    if '#' in href:
        href, frag = href.split('#', 1)
        frag = '#' + frag
    if not href:  # pure fragment
        return frag
    target = href[:-3] if href.endswith('.md') else href
    base = current_slug.rsplit('/', 1)[0] if '/' in current_slug else ''
    parts = (base.split('/') if base else [])
    for seg in target.split('/'):
        if seg in ('', '.'):
            continue
        if seg == '..':
            if parts:
                parts.pop()
        else:
            parts.append(seg)
    resolved = '/'.join(parts)
    if resolved == 'intro':
        return '/docs' + frag
    return f'/docs/{resolved}{frag}'


def _rewrite_html(html: str, current_slug: str) -> str:
    # Images: /img/foo.png -> /static/docs-img/foo.png
    html = re.sub(r'(src=")/img/', r'\1/static/docs-img/', html)

    # Internal markdown links: href="...md" (relative, not http).
    def link_repl(m):
        quote, href = m.group(1), m.group(2)
        if href.startswith(('http://', 'https://', 'mailto:', '/', '#')):
            return m.group(0)
        if href.endswith('.md') or '.md#' in href:
            return f'href={quote}{_resolve_link(href, current_slug)}{quote}'
        return m.group(0)

    html = re.sub(r'href=(["\'])(.*?)\1', link_repl, html)
    return html


def render_page(slug: str):
    """Render a doc page. Returns dict with html/title/prev/next or None."""
    if slug in ('', '/'):
        slug = 'intro'
    slug = slug.strip('/')
    if not _slug_exists(slug):
        return None

    fm, body = _split_frontmatter(_raw(slug))
    body = _convert_admonitions(body)

    md = markdown.Markdown(extensions=[
        'extra',          # tables, fenced_code, attr_list, md_in_html, ...
        'admonition',
        'toc',
        'sane_lists',
    ])
    html = md.convert(body)
    html = _rewrite_html(html, slug)

    title = fm.get('title') or _page_title(slug)

    prev_slug = next_slug = None
    if slug in FLAT_SLUGS:
        i = FLAT_SLUGS.index(slug)
        if i > 0:
            prev_slug = FLAT_SLUGS[i - 1]
        if i < len(FLAT_SLUGS) - 1:
            next_slug = FLAT_SLUGS[i + 1]

    def link(s):
        if not s:
            return None
        url = '/docs' if s == 'intro' else f'/docs/{s}'
        return {'url': url, 'title': _page_title(s)}

    return {
        'slug': slug,
        'title': title,
        'html': html,
        'prev': link(prev_slug),
        'next': link(next_slug),
    }


def build_nav(current_slug: str):
    """Build sidebar nav structure for the template."""
    out = []
    for label, slugs in NAV:
        items = []
        for s in slugs:
            url = '/docs' if s == 'intro' else f'/docs/{s}'
            items.append({
                'url': url,
                'title': _page_title(s),
                'active': s == current_slug,
            })
        out.append({'label': label, 'pages': items})
    return out
