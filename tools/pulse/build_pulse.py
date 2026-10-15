#!/usr/bin/env python3
"""Build g-line's Pulse feed and publish it to the repository's `pulse` branch.

Operator tooling, not part of the mod: the mod only reads the published file
(https://raw.githubusercontent.com/lifeofgurpreet/g-line/pulse/pulse.json),
and only when a person turns Pulse on.

  python3 tools/pulse/build_pulse.py --out /tmp/pulse.json            # build only
  python3 tools/pulse/build_pulse.py --publish --repo /path/to/g-line   # build, commit to `pulse`, push

Sources, each labelled as what it is (no source is passed off as another):
  - curated.json on the `pulse` branch: items the operator adds by hand. An X post needs only its
    URL; its author and text are filled in. `x_accounts` there replaces the watched account list.
  - X posts (no API key): recent post IDs of a few watched accounts come from X's embedded-timeline
    page when it answers (it rate-limits hard, so a refusal is skipped) and from the Internet
    Archive's index (complete but days behind). X's public embed endpoint then gives each post's
    text, likes and reply status. Replies and other people's posts are left out; the best of the
    last 7 days by likes, discounted by age, are kept. The mod shows the age of older posts.
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
# Accounts watched for X posts: Claude, Anthropic and the Claude Code team.
X_ACCOUNTS = ('claudeai', 'AnthropicAI', 'bcherny', '_catwu', 'alexalbert__')
X_STATUS = re.compile(r'^https://(?:www\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/(\d{5,25})')


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
            out.append(item(re.sub(r'\s*[|\\]\s*Anthropic\s*$', '', title.group(1)), url, 'Anthropic', at))
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


def x_post(post_id):
    """One X post from the public embed endpoint (the one embedded posts use; no key), or None."""
    data = json.loads(get(f'https://cdn.syndication.twimg.com/tweet-result?id={post_id}&lang=en&token=x'))
    if data.get('__typename') != 'Tweet' or not data.get('user', {}).get('screen_name'):
        return None
    text = data.get('text', '')
    start, end = (data.get('display_text_range') or [0, len(text)])[:2]
    text = re.sub(r'https://t\.co/\S+', '', text[start:end])
    return {'handle': data['user']['screen_name'], 'text': text, 'likes': data.get('favorite_count', 0),
            'reply': bool(data.get('in_reply_to_status_id_str')), 'at': parse_time(data.get('created_at') or '')}


def x_item(post, post_id):
    return item(post['text'], f"https://x.com/{post['handle']}/status/{post_id}", f"𝕏 @{post['handle']}", post['at'])


def x_posted_at(post_id):
    """When an X post was made, from its ID (X's IDs carry a millisecond timestamp)."""
    return dt.datetime.fromtimestamp(((int(post_id) >> 22) + 1288834974657) / 1000, dt.timezone.utc)


def x_recent_ids(handle, days):
    """Recent post IDs of one account: X's embedded timeline when it answers, plus the Archive's index."""
    ids = set()
    try:
        page = get(f'https://syndication.twitter.com/srv/timeline-profile/screen-name/{handle}')
        ids.update(re.findall(r'"id_str":"(\d{15,25})"', page))
    except Exception:
        pass  # usually a 429: the page allows very few requests per address
    since = (NOW - dt.timedelta(days=days)).strftime('%Y%m%d')
    try:
        rows = json.loads(get(f'https://web.archive.org/cdx/search/cdx?url=x.com/{handle}/status/&matchType=prefix'
                              f'&from={since}&output=json&fl=original&collapse=urlkey&limit=300', timeout=40) or '[]')
    except Exception:
        rows = []
    for (original,) in rows[1:]:
        m = X_STATUS.match(original.replace('http://', 'https://'))
        if m and m.group(1).lower() == handle.lower():
            ids.add(m.group(2))
    return {i for i in ids if NOW - x_posted_at(i) < dt.timedelta(days=days)}


def x_posts(accounts=X_ACCOUNTS, days=7, keep=3):
    """The best recent posts of the watched accounts: most likes, discounted by age."""
    watched = {a.lower() for a in accounts}
    ids = set()
    for handle in accounts:
        ids |= x_recent_ids(handle, days)
    found = []
    for post_id in sorted(ids, reverse=True)[:40]:
        try:
            post = x_post(post_id)
        except Exception:
            continue
        # A reply, even in their own thread, reads as half a sentence on its own; a timeline can also carry others' posts.
        if post and not post['reply'] and post['at'] and post['handle'].lower() in watched and clean(post['text']):
            age_days = max(0.0, (NOW - post['at']).total_seconds() / 86400)
            found.append((post['likes'] / (1 + age_days), x_item(post, post_id)))
    return [i for _, i in sorted(found, key=lambda x: -x[0])[:keep]]


def curated_file(repo):
    try:
        raw = subprocess.run(['git', '-C', repo, 'show', 'origin/pulse:curated.json'], capture_output=True, text=True, check=True).stdout
        return json.loads(raw)
    except Exception:
        return {}


def curated(data):
    """Hand-picked items from curated.json: title, url and source, or just the URL of an X post."""
    out = []
    for c in data.get('items', []):
        until = parse_time(c.get('until') or '')
        if until and until < NOW:
            continue
        url = str(c.get('url', ''))
        x = X_STATUS.match(url)
        if x and not c.get('title'):
            try:
                post = x_post(x.group(2))
            except Exception:
                post = None
            if post:
                out.append(x_item(post, x.group(2)))
        elif c.get('title') and url.startswith('https://') and c.get('source'):
            out.append(item(c['title'], url, clean(c['source'], 28), parse_time(c.get('published_at') or '') or NOW))
    return out


def build(repo):
    items, notes = [], []
    picked = curated_file(repo) if repo else {}
    accounts = tuple(a for a in picked.get('x_accounts', X_ACCOUNTS) if re.fullmatch(r'[A-Za-z0-9_]{1,15}', str(a)))
    for name, fn in (('curated', lambda: curated(picked)), ('claude-code', claude_code_releases),
                     ('x', lambda: x_posts(accounts)), ('anthropic', anthropic_news), ('hn', hacker_news),
                     ('simonw', simon_willison)):
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
            'sources': 'curated, Claude Code releases, X, Anthropic, Hacker News, Simon Willison'}
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
