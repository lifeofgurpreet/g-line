#!/usr/bin/env python3
"""Build g-line's Pulse feed and publish it to the repository's `pulse` branch.

Operator tooling, not part of the mod: the mod only reads the published file
(https://raw.githubusercontent.com/lifeofgurpreet/g-line/pulse/pulse.json),
and only when a person turns Pulse on.

  python3 tools/pulse/build_pulse.py --out /tmp/pulse.json            # build only
  python3 tools/pulse/build_pulse.py --publish --repo /path/to/g-line   # build, commit to `pulse`, push

Sources, each labelled as what it is (no source is passed off as another):
  - curated.json on the `pulse` branch: items the operator adds by hand (his own posts by URL)
  - Claude Code releases (GitHub API, anthropics/claude-code)
  - Anthropic news (anthropic.com sitemap, pages changed in the last 3 days, their own titles)
  - Hacker News (Algolia API): stories naming Claude, or linking Anthropic's news or engineering pages, with 80+ points in 2 days
  - Simon Willison's weblog (Atom feed), AI and LLM entries from the last 3 days

Standard library only. Publishing never checks out or switches branches: it
writes the commit with git plumbing and pushes it as the operator.
"""
import argparse
import datetime as dt
import html
import json
import re
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET

UA = 'g-line-pulse/1 (+https://github.com/lifeofgurpreet/g-line)'
NOW = dt.datetime.now(dt.timezone.utc)
MAX_ITEMS = 10


def get(url, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(2_000_000).decode('utf-8', 'replace')


def iso(t):
    return t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_time(text):
    try:
        return dt.datetime.fromisoformat(text.replace('Z', '+00:00'))
    except Exception:
        return None


def clean(text, n=100):
    text = re.sub(r'[\x00-\x1f\x7f-\x9f]', ' ', html.unescape(text or ''))
    text = re.sub(r'\s+', ' ', text).strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + '…'


def item(title, url, source, at):
    return {'title': clean(title), 'url': url, 'source': source, 'published_at': iso(at) if at else None}


def claude_code_releases():
    data = json.loads(get('https://api.github.com/repos/anthropics/claude-code/releases?per_page=3'))
    out = []
    for r in data:
        at = parse_time(r.get('published_at') or '')
        if at and NOW - at < dt.timedelta(days=7):
            out.append(item(f"Claude Code {r.get('tag_name', '').lstrip('v')} released", r.get('html_url'), 'Claude Code releases', at))
    return out[:1]


def anthropic_news():
    xml = get('https://www.anthropic.com/sitemap.xml')
    entries = re.findall(r'<loc>(https://www\.anthropic\.com/news/[^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>', xml)
    recent = sorted(((parse_time(m), u) for u, m in entries if parse_time(m) and NOW - parse_time(m) < dt.timedelta(days=3)), reverse=True)
    out = []
    for at, url in recent[:2]:
        page = get(url)
        title = re.search(r'<title>([^<]+)</title>', page)
        if title:
            out.append(item(re.sub(r'\s*\\?\s*Anthropic\s*$', '', title.group(1)), url, 'Anthropic', at))
    return out


def hacker_news():
    since = int((NOW - dt.timedelta(days=2)).timestamp())
    seen, out = set(), []
    for q in ('claude', 'anthropic', 'claude code'):
        data = json.loads(get(f'https://hn.algolia.com/api/v1/search_by_date?tags=story&query={urllib.request.quote(q)}'
                              f'&numericFilters=points%3E80,created_at_i%3E{since}&hitsPerPage=10'))
        for h in data.get('hits', []):
            # Dev news: the title names Claude, or the link is Anthropic's own news or engineering page.
            url = h.get('url') or ''
            if h['objectID'] in seen or not (re.search(r'\bclaude\b', h.get('title', ''), re.I)
                                             or re.match(r'https://www\.anthropic\.com/(news|engineering)/', url)):
                continue
            seen.add(h['objectID'])
            url = h.get('url') or f"https://news.ycombinator.com/item?id={h['objectID']}"
            out.append((h.get('points', 0), item(h.get('title'), url, 'Hacker News', dt.datetime.fromtimestamp(h['created_at_i'], dt.timezone.utc))))
    return [i for _, i in sorted(out, key=lambda x: -x[0])[:3]]


def simon_willison():
    root = ET.fromstring(get('https://simonwillison.net/atom/entries/'))
    ns = {'a': 'http://www.w3.org/2005/Atom'}
    out = []
    for e in root.findall('a:entry', ns)[:6]:
        at = parse_time(e.findtext('a:updated', '', ns) or e.findtext('a:published', '', ns))
        link = e.find('a:link', ns)
        about = f"{e.findtext('a:title', '', ns)} {e.findtext('a:summary', '', ns)}"
        if at and NOW - at < dt.timedelta(days=3) and link is not None and re.search(r'claude|anthropic|llm|\bmodels?\b|\bagents?\b|\bai\b', about, re.I):
            out.append(item(e.findtext('a:title', '', ns), link.get('href'), "Simon Willison's weblog", at))
    return out[:2]


def curated(repo):
    """Hand-picked items from curated.json on the pulse branch; each needs title, url and source."""
    try:
        raw = subprocess.run(['git', '-C', repo, 'show', 'origin/pulse:curated.json'], capture_output=True, text=True, check=True).stdout
        data = json.loads(raw)
    except Exception:
        return []
    out = []
    for c in data.get('items', []):
        at = parse_time(c.get('published_at') or '') or NOW
        until = parse_time(c.get('until') or '')
        if until and until < NOW:
            continue
        if c.get('title') and str(c.get('url', '')).startswith('https://') and c.get('source'):
            out.append(item(c['title'], c['url'], clean(c['source'], 28), at))
    return out


def build(repo):
    items, notes = [], []
    for name, fn in (('curated', lambda: curated(repo) if repo else []), ('claude-code', claude_code_releases),
                     ('anthropic', anthropic_news), ('hn', hacker_news), ('simonw', simon_willison)):
        try:
            got = fn()
            items += got
            notes.append(f'{name}:{len(got)}')
        except Exception as exc:  # one source down never stops the feed
            notes.append(f'{name}:error {type(exc).__name__}')
    seen, unique = set(), []
    for i in items:
        if i['url'] and i['url'] not in seen and i['url'].startswith('https://'):
            seen.add(i['url'])
            unique.append(i)
    feed = {'schema': 1, 'generated_at': iso(NOW), 'items': unique[:MAX_ITEMS],
            'sources': 'curated, Claude Code releases, Anthropic, Hacker News, Simon Willison'}
    return feed, notes


def git(repo, *args, data=None):
    return subprocess.run(['git', '-C', repo, *args], input=data, capture_output=True, text=True, check=True).stdout.strip()


def publish(repo, feed, push_cmd):
    git(repo, 'fetch', '-q', 'origin', 'pulse')
    parent = git(repo, 'rev-parse', 'origin/pulse')
    old = json.loads(git(repo, 'show', 'origin/pulse:pulse.json') or '{}')
    if [i['url'] for i in old.get('items', [])] == [i['url'] for i in feed['items']] and \
            [i['title'] for i in old.get('items', [])] == [i['title'] for i in feed['items']]:
        print('unchanged; nothing published')
        return
    blob = git(repo, 'hash-object', '-w', '--stdin', data=json.dumps(feed, indent=1, ensure_ascii=False) + '\n')
    entries = [line for line in git(repo, 'ls-tree', 'origin/pulse').splitlines() if not line.endswith('\tpulse.json')]
    entries.append(f'100644 blob {blob}\tpulse.json')
    tree = git(repo, 'mktree', data='\n'.join(entries) + '\n')
    env_author = ['-c', 'user.name=Gurpreet', '-c', 'user.email=60426541+lifeofgurpreet@users.noreply.github.com']
    commit = subprocess.run(['git', '-C', repo, *env_author, 'commit-tree', tree, '-p', parent, '-m',
                             f"pulse: {len(feed['items'])} items, {feed['generated_at']}\n\nAgent: g-line-pulse"],
                            capture_output=True, text=True, check=True).stdout.strip()
    subprocess.run([*push_cmd, 'push', 'origin', f'{commit}:refs/heads/pulse'], cwd=repo, check=True)
    print(f'published {commit[:8]} with {len(feed["items"])} items')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--repo', help='the g-line checkout (for curated.json and publishing)')
    ap.add_argument('--out', help='also write the feed here')
    ap.add_argument('--publish', action='store_true')
    ap.add_argument('--push', default='bbi-user-gh --expected-login lifeofgurpreet --git --author-name Gurpreet --',
                    help='the command prefix that runs a git operation as the operator')
    args = ap.parse_args()
    feed, notes = build(args.repo)
    print(' '.join(notes))
    if args.out:
        with open(args.out, 'w') as f:
            json.dump(feed, f, indent=1, ensure_ascii=False)
    if args.publish:
        if not args.repo:
            sys.exit('--publish needs --repo')
        publish(args.repo, feed, args.push.split())


if __name__ == '__main__':
    main()
