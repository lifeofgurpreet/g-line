#!/usr/bin/env python3
"""Build g-line's Pulse feed and publish it to the repository's `pulse` branch.

Maintainer tooling, not part of the mod: the mod only reads the published file
(https://raw.githubusercontent.com/lifeofgurpreet/g-line/pulse/pulse.json),
and only when a person turns Pulse on.

  python3 tools/pulse/build_pulse.py --out /tmp/pulse.json            # build only
  python3 tools/pulse/build_pulse.py --publish --repo /path/to/g-line   # build, commit to `pulse`, push

The feed reads like a front page: the best items first, at most one per story, and a mix of
kinds (the day's big story, voices on X, Claude Code and Anthropic news, Hacker News, Simon
Willison). 0.5.x readers show the first eight, so order is the ranking.

Sources, each labelled as what it is (no source is passed off as another):
  - curated.json on the `pulse` branch: items the maintainer adds by hand. An X post needs only its
    URL; its author and text are filled in. `x_accounts` there replaces the archive-watched list.
  - Techmeme's front page: AI stories, ranked the way Techmeme ranks them (position on the page,
    then how much coverage the story drew). The item is the publisher's article, labelled with the
    publisher's name; `via` says Techmeme found it.
  - X posts (no API key): links harvested from Techmeme's story clusters (the voices Techmeme
    lists under a story), from the hot pages of AI subreddits (RSS) and, for the watched accounts,
    from the Internet Archive's index. X's public embed endpoint gives author, text, time, likes and
    reply status. A post has to be about AI itself, not a reply, and fresh or strong. Likes are
    weighted by who posted: a short list of high-signal AI accounts (labs, their builders,
    researchers, reporters; the AINews idea of a hand-kept list of people worth hearing) counts
    five or three times, everyone else once and must clear a higher bar. Ranked like Hacker News:
    weighted likes over (age + 2) ** 1.5. A post's `story` gives the headline it reacts to.
  - Claude Code releases (GitHub API, anthropics/claude-code), with the release's first notes
  - Anthropic news (anthropic.com sitemap, pages changed in the last 3 days, their own titles)
  - Hacker News (Algolia API): the front page's AI stories, plus stories naming Claude with 80+
    points in 2 days; ranked by HN's own gravity, points over (age + 2) ** 1.8
  - Simon Willison's weblog (Atom feed), AI and LLM entries from the last 3 days

Item fields (schema 1; everything past the first four is optional, for newer readers):
  title, url, source, published_at   short headline (<= 100 chars), https link, label, ISO time
  text          the full post or a one-paragraph summary, plain text, <= 600 chars
  author_name   an X author's display name
  likes         an X post's likes
  story         for an X post, the headline of the story it is about (Techmeme or Reddit)
  via           how the item was found when the source is the publisher (`Techmeme`)
  points        Hacker News points
  discussion    the Hacker News comments page
  links         the https links an X post carries (its article, if any)

Standard library only. Publishing never checks out or switches branches: it
writes the commit with git plumbing and pushes it (`--push` names a wrapper, `--author` the identity).
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
from concurrent.futures import ThreadPoolExecutor

UA = 'g-line-pulse/1 (+https://github.com/lifeofgurpreet/g-line)'
NOW = dt.datetime.now(dt.timezone.utc)
MAX_ITEMS = 15
# Accounts whose posts are also looked up in the Internet Archive: Claude, Anthropic, the Claude Code team.
X_ACCOUNTS = ('claudeai', 'AnthropicAI', 'bcherny', '_catwu', 'alexalbert__')
# Whose likes count more: a hand-kept list of high-signal AI voices. Five times: the labs and their
# product accounts, and the people who ship or lead them. Three times: researchers, builders and
# reporters whose posts tend to be news rather than reaction.
X_WEIGHT = {**{h.lower(): 5 for h in (
    'claudeai', 'AnthropicAI', 'bcherny', '_catwu', 'alexalbert__', 'DarioAmodei', 'jackclarkSF', 'mikeyk',
    'OpenAI', 'OpenAIDevs', 'ChatGPTapp', 'sama', 'gdb', 'markchen90', 'kevinweil', 'GoogleDeepMind', 'GoogleAI',
    'demishassabis', 'JeffDean', 'OfficialLoganK', 'sundarpichai', 'AIatMeta', 'alexandr_wang', 'xai', 'MistralAI',
    'deepseek_ai', 'Alibaba_Qwen', 'huggingface', 'karpathy', 'simonw', 'swyx', 'AndrewYNg', 'ylecun', 'cursor_ai',
    'github', 'satyanadella', 'NVIDIAAI', 'lmarena_ai', 'ArtificialAnlys', 'METR_Evals', 'EpochAIResearch')},
    **{h.lower(): 3 for h in (
    'NeelNanda5', 'ch402', 'janleike', 'AmandaAskell', 'sleepinyourhat', 'jaredkaplan', 'tszzl', 'natolambert',
    'emollick', 'fchollet', 'hardmaru', 'goodside', 'hwchase17', 'jxnlco', 'mckaywrigley', 'amasad', 'rauchg',
    'steipete', 'Teknium1', '_akhaliq', 'ClementDelangue', 'natfriedman', 'danielgross', 'paulg', 'garrytan',
    'AndrewCurran_', 'kevinroose', 'CaseyNewton', 'steph_palazzolo', 'markgurman', 'ashleyrgold', 'btibor91',
    'testingcatalog', 'NousResearch', 'GergelyOrosz', 'trq212', 'lennysan', 'yuchenj_uw', 'teortaxestex', 'xlr8harder', 'levie', 'finkd', 'polynoamchen', 'npew',
    'joshwoodward', 'demi_guo', 'mervenoyann', 'reach_vb', 'Thom_Wolf', 'lilianweng', 'johnschulman2',
    'ilyasut', 'miramurati', 'aidan_mclau', 'willdepue', 'sebastienbubeck', 'jeremyphoward', 'zachtratar')}}
X_STATUS = re.compile(r'^https://(?:www\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/(\d{5,25})')
X_LINK = re.compile(r'(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/(\d{15,25})')
AI_WORDS = re.compile(r'\b(?:ai|a\.i\.|llms?|gpt[\w.-]*|claude|anthropic|openai|gemini|deepmind|chatgpt|codex|copilot|cursor|'
                      r'mistral|llama|deepseek|qwen|grok|xai|nvidia|agents?|agentic|models?|mcp|inference|chatbots?|'
                      r'superintelligence|agi|hugging ?face|perplexity|open[- ]weights?|neural|interpretability|alignment|'
                      r'benchmarks?|tokens?|params|parameters|gguf|fine-?tun\w*|transformers?|evals?|vibe[- ]?cod\w*|'
                      r'gpus?|data ?cent(?:er|re)s?|muse|sora|veo|copilots?|reasoning)\b', re.I)
STOP = set('the a an of to in on for and or with by at from as is are be its it this that new says say said will has have'
           ' after over about into than more most how why what who which their his her our your up out not now'.split())


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


def text_of(markup):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', markup or ''))).strip()


def summary(text, n=600):
    """Plain text for an item's `text`: no markup, no bare links, whole sentences where they fit."""
    text = clean(re.sub(r'https?://\S+', '', text_of(text)), 10_000)
    if len(text) <= n:
        return text
    cut = text[:n]
    end = max(cut.rfind('. '), cut.rfind('! '), cut.rfind('? '))
    return cut[: end + 1] if end > n // 2 else clean(text, n)


def item(title, url, source, at, **extra):
    out = {'title': clean(title), 'url': url, 'source': source, 'published_at': iso(at) if at else None}
    out.update({k: v for k, v in extra.items() if v not in (None, '', 0)})
    return out


def age_h(at):
    return max(0.0, (NOW - at).total_seconds() / 3600) if at else 999.0


def words(text):
    return {w for w in re.findall(r'[a-z0-9]+', (text or '').lower()) if len(w) > 2 and w not in STOP}


def same_story(a, b):
    """Two headlines about one thing: most of the shorter one's words are in the other."""
    wa, wb = words(a), words(b)
    small = min(len(wa), len(wb))
    return small >= 3 and len(wa & wb) / small >= 0.6


def url_key(url):
    return re.sub(r'^https?://(www\.)?|[?#].*$|/$', '', url or '').lower()


# ------------------------------------------------------------------ sources

def claude_code_releases():
    data = json.loads(get('https://api.github.com/repos/anthropics/claude-code/releases?per_page=3'))
    out = []
    for r in data:
        at = parse_time(r.get('published_at') or '')
        if at and NOW - at < dt.timedelta(days=7):
            notes = [clean(re.sub(r'^\s*[-*]\s*|`|\*\*', '', line), 200) for line in (r.get('body') or '').splitlines()
                     if re.match(r'\s*[-*]\s+\S', line)]
            text = ' · '.join(notes[:4])
            out.append((age_h(at), item(f"Claude Code {r.get('tag_name', '').lstrip('v')} released", r.get('html_url'),
                                        'Claude Code releases', at, text=summary(text) if text else None)))
    return [i for _, i in out[:1]]


def meta_description(page):
    m = re.search(r'<meta[^>]+(?:name|property)="(?:og:)?description"[^>]+content="([^"]*)"', page, re.I) or \
        re.search(r'<meta[^>]+content="([^"]*)"[^>]+(?:name|property)="(?:og:)?description"', page, re.I)
    return summary(m.group(1)) if m else None


def anthropic_news():
    xml = get('https://www.anthropic.com/sitemap.xml')
    entries = re.findall(r'<loc>(https://www\.anthropic\.com/news/[^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>', xml)
    recent = sorted(((parse_time(m), u) for u, m in entries if parse_time(m) and NOW - parse_time(m) < dt.timedelta(days=3)), reverse=True)
    out = []
    for at, url in recent[:2]:
        page = get(url)
        title = re.search(r'<title>([^<]+)</title>', page)
        if title:
            out.append(item(re.sub(r'\s*[|\\]\s*Anthropic\s*$', '', title.group(1)), url, 'Anthropic', at,
                            text=meta_description(page)))
    return out


def hacker_news():
    """The front page's AI stories and the last two days' Claude stories, by HN's own gravity."""
    since = int((NOW - dt.timedelta(days=2)).timestamp())
    hits = json.loads(get('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60')).get('hits', [])
    hits = [h for h in hits if AI_WORDS.search(h.get('title') or '')]
    for q in ('claude', 'anthropic'):
        for h in json.loads(get(f'https://hn.algolia.com/api/v1/search_by_date?tags=story&query={q}'
                                f'&numericFilters=points%3E80,created_at_i%3E{since}&hitsPerPage=10')).get('hits', []):
            url = h.get('url') or ''
            if re.search(r'\bclaude\b', h.get('title', ''), re.I) or re.match(r'https://www\.anthropic\.com/(news|engineering)/', url):
                hits.append(h)
    seen, out = set(), []
    for h in hits:
        if h['objectID'] in seen or (h.get('points') or 0) < 60:
            continue
        seen.add(h['objectID'])
        at = dt.datetime.fromtimestamp(h['created_at_i'], dt.timezone.utc)
        url = h.get('url') or f"https://news.ycombinator.com/item?id={h['objectID']}"
        points, comments = h.get('points') or 0, h.get('num_comments') or 0
        text = f"{points} points and {comments} comments on Hacker News."
        out.append((points / (age_h(at) + 2) ** 1.8, item(h.get('title'), url, 'Hacker News', at, text=text, points=points,
                                                          discussion=f"https://news.ycombinator.com/item?id={h['objectID']}")))
    return [i for _, i in sorted(out, key=lambda x: -x[0])[:4]]


def simon_willison():
    root = ET.fromstring(get('https://simonwillison.net/atom/entries/'))
    ns = {'a': 'http://www.w3.org/2005/Atom'}
    out = []
    for e in root.findall('a:entry', ns)[:6]:
        at = parse_time(e.findtext('a:updated', '', ns) or e.findtext('a:published', '', ns))
        link = e.find('a:link', ns)
        about = f"{e.findtext('a:title', '', ns)} {e.findtext('a:summary', '', ns)}"
        if at and NOW - at < dt.timedelta(days=3) and link is not None and re.search(r'claude|anthropic|llm|\bmodels?\b|\bagents?\b|\bai\b', about, re.I):
            body = e.findtext('a:summary', '', ns) or e.findtext('a:content', '', ns)
            out.append(item(e.findtext('a:title', '', ns), link.get('href'), "Simon Willison's weblog", at,
                            text=summary(body) or None))
    return out[:2]


def techmeme_items_html(page):
    """Each story's own HTML on Techmeme's page, top first. A story starts at its anchor
    (`<A NAME="a261018p9">`) and ends at the next one or at a column break. Splitting on the
    `clus` blocks instead let the last one run on over the stories further down the page,
    which carry no `clus`, so their posts on X were filed under the wrong headline."""
    chunks = re.split(r'(?=<A NAME="a\d+p\d+">)', page)[1:]
    stories = [re.split(r'<DIV ID="(?:topcol|botcol|events)', chunk, maxsplit=1, flags=re.I)[0] for chunk in chunks]
    return [story for story in stories if 'CLASS="ourh"' in story]


def techmeme():
    """Techmeme's front page as (stories, x_ids). A story: its rank on the page, headline, publisher,
    summary, how many outlets and voices it drew, and when Techmeme posted it. x_ids: each X post
    Techmeme lists under a story, with that story's key and headline."""
    page = get('https://www.techmeme.com/')
    stories, x_ids = [], {}
    for n, cluster in enumerate(techmeme_items_html(page)):
        head = re.search(r'<A CLASS="ourh" HREF="([^"]+)">(.*?)</A>', cluster, re.S)
        if not head:
            continue
        cite = re.search(r'<CITE>(.*?)</CITE>', cluster, re.S)
        blurb = re.search(r'</STRONG>\s*(?:&nbsp;)?\s*&mdash;(?:&nbsp;)?(.*?)</DIV>', cluster, re.S)
        twid = re.search(r'twid="(\d+)"', cluster)
        headline = text_of(head.group(2))
        coverage = len(re.findall(r'<A HREF=', cluster, re.I))
        stories.append({'rank': n, 'url': head.group(1), 'headline': headline,
                        'publisher': clean(text_of(cite.group(1)).rstrip(':'), 28) if cite else 'Techmeme',
                        'blurb': text_of(blurb.group(1)) if blurb else '', 'coverage': coverage,
                        'at': x_posted_at(twid.group(1)) if twid else None,
                        'ai': bool(AI_WORDS.search(headline))})
        for handle, post_id in X_LINK.findall(cluster):
            if handle.lower() != 'techmeme':  # its own posts repeat the headline; the voices around it are the news
                x_ids.setdefault(post_id, (f'techmeme#{n}', headline, handle))
    return stories, x_ids


def techmeme_items(stories):
    """Techmeme's AI stories, best first: higher on the page and wider coverage win, decayed by age."""
    out = []
    for s in stories:
        if not s['ai'] or not s['url'].startswith('https://'):
            continue
        score = (s['coverage'] + 10) / (s['rank'] + 3) / (age_h(s['at']) + 4) ** 0.5
        text = f"{s['headline']}. {s['blurb']}" if s['blurb'] else s['headline']
        out.append((score, item(s['headline'], s['url'], s['publisher'], s['at'], text=summary(text), via='Techmeme')))
    return [i for _, i in sorted(out, key=lambda x: -x[0])]


# ------------------------------------------------------------------ X

def x_post(post_id):
    """One X post from the public embed endpoint (the one embedded posts use; no key), or None."""
    data = json.loads(get(f'https://cdn.syndication.twimg.com/tweet-result?id={post_id}&lang=en&token=x'))
    if data.get('__typename') != 'Tweet' or not data.get('user', {}).get('screen_name'):
        return None
    text = data.get('text', '')
    start, end = (data.get('display_text_range') or [0, len(text)])[:2]
    text = re.sub(r'https://t\.co/\S+', '', text[start:end]).strip()
    if data.get('note_tweet') and text and not text.endswith('…'):
        text += '…'  # a long post: the embed carries its opening only
    quoted = data.get('quoted_tweet') or {}
    user = data['user']
    links = [u.get('expanded_url') for u in (data.get('entities') or {}).get('urls', []) if u.get('expanded_url')]
    return {'handle': user['screen_name'], 'name': user.get('name') or '', 'text': text, 'likes': data.get('favorite_count', 0),
            'verified': bool(user.get('verified')) or user.get('verified_type') in ('Business', 'Government'),
            'reply': bool(data.get('in_reply_to_status_id_str')), 'sensitive': bool(data.get('possibly_sensitive')),
            'quoted': (f"@{quoted.get('user', {}).get('screen_name', '')}: {quoted.get('text', '')}" if quoted.get('text') else ''),
            'links': links, 'at': parse_time(data.get('created_at') or '')}


def x_item(post, post_id, story=None):
    quoted = re.sub(r'https://t\.co/\S+', '', post.get('quoted') or '').strip()
    context = story or ('Quoting ' + quoted if quoted else None)
    return item(post['text'], f"https://x.com/{post['handle']}/status/{post_id}", f"𝕏 @{post['handle']}", post['at'],
                text=summary(post['text']), author_name=clean(post.get('name'), 50) or None, likes=post.get('likes') or None,
                story=clean(context, 160) if context else None, links=[u for u in post.get('links', []) if u.startswith('https://')][:3] or None)


def x_posted_at(post_id):
    """When an X post was made, from its ID (X's IDs carry a millisecond timestamp)."""
    return dt.datetime.fromtimestamp(((int(post_id) >> 22) + 1288834974657) / 1000, dt.timezone.utc)


def reddit_x_ids():
    """X posts linked from the hot pages of AI subreddits (their public RSS), with the thread's title."""
    feed = get('https://www.reddit.com/r/ClaudeAI+Anthropic+ClaudeCode+singularity+LocalLLaMA+OpenAI+ChatGPTCoding/hot/.rss?limit=100')
    found = {}
    for entry in re.findall(r'<entry>(.*?)</entry>', feed, re.S):
        title = re.search(r'<title>(.*?)</title>', entry, re.S)
        for handle, post_id in X_LINK.findall(html.unescape(entry)):
            found.setdefault(post_id, (f'reddit:{post_id}', text_of(title.group(1)) if title else None, handle))
    return found


def archive_x_ids(handle, days=3):
    """The watched account's post IDs in the Internet Archive's index (complete, but often days behind)."""
    since = (NOW - dt.timedelta(days=days)).strftime('%Y%m%d')
    rows = json.loads(get(f'https://web.archive.org/cdx/search/cdx?url=x.com/{handle}/status/&matchType=prefix'
                          f'&from={since}&output=json&fl=original&collapse=urlkey&limit=300', timeout=40) or '[]')
    return {m.group(2): (f'archive:{m.group(2)}', None, handle) for (original,) in rows[1:]
            for m in [X_STATUS.match(original.replace('http://', 'https://'))] if m and m.group(1).lower() == handle.lower()}


def x_weight(post):
    return X_WEIGHT.get(post['handle'].lower(), 1.5 if post.get('verified') else 1)


def x_qualifies(likes, age, weight):
    """Fresh, or strong enough to stay. Likes count `weight` times (5 or 3 for the listed voices),
    and the bar is set for an unlisted account: 40 within 2 hours, 40 an hour within a day, 3,000
    within 3 days. A listed voice clears it with a fifth or a third of that."""
    likes *= weight
    return (age < 2 and likes >= 40) or (age < 24 and likes >= 40 * age) or (age < 72 and likes >= 3000)


def x_score(post, from_techmeme_rank=None):
    """Hacker News's gravity on weighted likes. A voice Techmeme lists under a top story is lifted;
    one reacting to a story it isn't the source of (anyone but a lab or product account) gives way
    to the primary source, as an editor would lead with the announcement."""
    score = (post['likes'] * x_weight(post) + 20) / (age_h(post['at']) + 2) ** 1.5
    if from_techmeme_rank is not None:
        score *= (1 + 2 / (from_techmeme_rank + 2)) * (1 if x_weight(post) >= 5 else 0.6)
    return score


def x_posts(found, accounts=X_ACCOUNTS):
    """X posts about AI, best first. `found` maps post ID to (story key, story headline, handle)."""
    story = dict(found)
    own = {a.lower() for a in X_ACCOUNTS}
    notes = []
    for a in accounts:
        try:
            for post_id, where in archive_x_ids(a).items():
                story.setdefault(post_id, where)
        except Exception as exc:
            notes.append(f'@{a} {type(exc).__name__}')
    # The listed voices are looked up first whatever their age, then everyone else newest first.
    recent = [i for i in story if NOW - x_posted_at(i) < dt.timedelta(hours=72)]
    ids = sorted(recent, key=lambda i: (story[i][2].lower() not in X_WEIGHT, -int(i)))[:200]

    def fetch(post_id):
        try:
            return post_id, x_post(post_id)
        except Exception:
            return post_id, None

    with ThreadPoolExecutor(8) as pool:
        posts = list(pool.map(fetch, ids))
    scored = []
    for post_id, post in posts:
        # A reply reads as half a sentence on its own; a post of a few words says nothing.
        if not post or post['reply'] or post['sensitive'] or not post['at'] or len(clean(post['text'], 1000)) < 30:
            continue
        weight = x_weight(post)
        # The post itself has to be about AI (Claude's and Anthropic's own accounts excepted):
        # a story about AI also gathers jokes and asides.
        if not (post['handle'].lower() in own or AI_WORDS.search(post['text'])):
            continue
        if not x_qualifies(post['likes'], age_h(post['at']), weight):
            continue
        key, headline, _ = story[post_id]
        rank = int(key.split('#')[1]) if key.startswith('techmeme#') else None
        # An unlisted account's take on a Techmeme story is a reaction; the story itself is the
        # news, and the Techmeme lane carries it. Only a huge post stands on its own.
        if rank is not None and weight < 3 and post['likes'] < 5000:
            continue
        scored.append((x_score(post, rank), post, post_id, key, headline))
    if notes:
        print('x sources down:', ', '.join(notes), file=sys.stderr)
    return [(s, x_item(post, post_id, headline), key) for s, post, post_id, key, headline in sorted(scored, key=lambda x: -x[0])]


# ------------------------------------------------------------------ the front page

def front_page(lanes, limit=MAX_ITEMS):
    """Lay the page out like an editor: take lanes in turn (the day's big story, a voice on X, a
    Claude Code or Anthropic item, the newest post worth reading, Hacker News, ...), each lane's
    best item that isn't a story or an author already on the page. Lanes that run dry are skipped;
    then the rest fill in from X, then from the other lanes' leftovers, so a quiet day on X still
    gives a full page (a short page makes Pulse's row run out of new headlines sooner). 0.5.x
    readers show the first eight, so the first eight carry every kind, a post from the last hours
    among them when there is one."""
    pattern = ['curated', 'techmeme', 'x', 'dev', 'fresh', 'x', 'techmeme', 'hn', 'x', 'dev', 'fresh', 'simonw', 'techmeme', 'x', 'hn']
    page, story_keys, urls, heads = [], set(), set(), []

    def fits(entry):
        it, key = entry
        if {url_key(u) for u in [it['url'], *it.get('links', [])]} & urls or (key and key in story_keys):
            return False
        if it['source'].startswith('𝕏 @') and it['source'].lower() in story_keys:  # one post per author
            return False
        return not any(same_story(about, h) for about in filter(None, (it['title'], it.get('story'))) for h in heads)

    def take(entry):
        it, key = entry
        page.append(it)
        urls.update(url_key(u) for u in [it['url'], *it.get('links', [])])
        if key:
            story_keys.update((key, it['source'].lower()))
        heads.extend(filter(None, (it['title'], it.get('story'))))

    queues = {k: list(v) for k, v in lanes.items()}
    for lane in pattern + ['x'] * limit + ['techmeme', 'hn', 'dev', 'simonw', 'curated'] * limit:
        if len(page) >= limit:
            break
        q = queues.get(lane, [])
        while q:
            entry = q.pop(0)
            if fits(entry):
                take(entry)
                break
    return page


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
            out.append(item(c['title'], url, clean(c['source'], 28), parse_time(c.get('published_at') or '') or NOW,
                            text=summary(c.get('text') or '') or None))
    return out


def build(repo):
    notes = []
    picked = curated_file(repo) if repo else {}
    accounts = tuple(a for a in picked.get('x_accounts', X_ACCOUNTS) if re.fullmatch(r'[A-Za-z0-9_]{1,15}', str(a)))

    def run(name, fn, default):
        try:
            got = fn()
            notes.append(f'{name}:{len(got[0]) if name == "techmeme" else len(got)}')
            return got
        except Exception as exc:  # one source down never stops the feed
            notes.append(f'{name}:error {type(exc).__name__}')
            return default

    stories, tm_x = run('techmeme', techmeme, ([], {}))
    rd_x = run('reddit', reddit_x_ids, {})
    found = {**rd_x, **tm_x}  # Techmeme's story context wins over Reddit's
    lanes = {
        'curated': [(i, None) for i in run('curated', lambda: curated(picked), [])],
        'techmeme': [(i, None) for i in techmeme_items(stories)],
        'x': [(i, key) for _, i, key in run('x', lambda: x_posts(found, accounts), [])],
        'fresh': [],
        'dev': [(i, None) for i in run('claude-code', claude_code_releases, []) + run('anthropic', anthropic_news, [])],
        'hn': [(i, None) for i in run('hn', hacker_news, [])],
        'simonw': [(i, None) for i in run('simonw', simon_willison, [])],
    }
    # The newest posts that cleared the bar, from the last three hours: things move fast.
    lanes['fresh'] = sorted((e for e in lanes['x'] if age_h(parse_time(e[0]['published_at'] or '')) < 3),
                            key=lambda e: e[0]['published_at'], reverse=True)
    # The mod drops a link longer than 1000 characters (gift links' tokens run to ~400): never ship one it would drop.
    items = [i for i in front_page(lanes) if i['url'].startswith('https://') and len(i['url']) <= 1000]
    feed = {'schema': 1, 'generated_at': iso(NOW), 'items': items,
            'sources': 'curated, Techmeme, X (found via Techmeme, Reddit, the Internet Archive), Claude Code releases, '
                       'Anthropic, Hacker News, Simon Willison'}
    return feed, notes


def git(repo, *args, data=None):
    return subprocess.run(['git', '-C', repo, *args], input=data, capture_output=True, text=True, check=True).stdout.strip()


def publish(repo, feed, push_cmd, author=None):
    git(repo, 'fetch', '-q', 'origin', 'pulse')
    parent = git(repo, 'rev-parse', 'origin/pulse')
    old = json.loads(git(repo, 'show', 'origin/pulse:pulse.json') or '{}')
    if [(i['url'], i['title'], i.get('text')) for i in old.get('items', [])] == \
            [(i['url'], i['title'], i.get('text')) for i in feed['items']]:
        print('unchanged; nothing published')
        return
    blob = git(repo, 'hash-object', '-w', '--stdin', data=json.dumps(feed, indent=1, ensure_ascii=False) + '\n')
    entries = [line for line in git(repo, 'ls-tree', 'origin/pulse').splitlines() if not line.endswith('\tpulse.json')]
    entries.append(f'100644 blob {blob}\tpulse.json')
    tree = git(repo, 'mktree', data='\n'.join(entries) + '\n')
    env_author = []
    if author:
        name, _, email = author.partition('<')
        env_author = ['-c', f'user.name={name.strip()}', '-c', f'user.email={email.rstrip(">").strip()}']
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
    ap.add_argument('--push', default='git',
                    help='the command prefix that runs the push, for a wrapper that pushes as a given account')
    ap.add_argument('--author', help='"Name <email>" for the feed commit; git\'s own identity when left out')
    args = ap.parse_args()
    feed, notes = build(args.repo)
    print(' '.join(notes))
    if args.out:
        with open(args.out, 'w') as f:
            json.dump(feed, f, indent=1, ensure_ascii=False)
    if args.publish:
        if not args.repo:
            sys.exit('--publish needs --repo')
        publish(args.repo, feed, args.push.split(), args.author)


if __name__ == '__main__':
    main()
