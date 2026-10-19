"""Offline checks for the Pulse builder's ranking: `python3 -m unittest tools/pulse/test_build_pulse.py`."""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import build_pulse as b  # noqa: E402


def x(handle, title, hours, likes=100, key=None, story=None, links=None):
    at = b.NOW - dt.timedelta(hours=hours)
    it = b.item(title, f'https://x.com/{handle}/status/{abs(hash(title))}', f'𝕏 @{handle}', at, likes=likes, story=story, links=links)
    return it, key


def plain(source, title, url, hours=1):
    return b.item(title, url, source, b.NOW - dt.timedelta(hours=hours)), None


class Ranking(unittest.TestCase):
    def test_listed_voice_clears_the_bar_an_unlisted_one_does_not(self):
        self.assertTrue(b.x_qualifies(10, 1, 5))
        self.assertFalse(b.x_qualifies(10, 1, 1))
        self.assertTrue(b.x_qualifies(3000, 60, 1))

    def test_primary_source_outranks_a_reaction_with_the_same_likes(self):
        at = b.NOW - dt.timedelta(hours=3)
        lab = {'handle': 'AnthropicAI', 'likes': 1000, 'at': at}
        voice = {'handle': 'NeelNanda5', 'likes': 1000 * 5 / 3, 'at': at}
        self.assertGreater(b.x_score(lab, 2), b.x_score(voice, 2))

    def test_same_story(self):
        self.assertTrue(b.same_story('Meta releases Muse Spark Open, an open-weight model',
                                     'Meta releases Muse Spark Open open-weight model today'))
        self.assertFalse(b.same_story('Anthropic update on independent evaluators', 'Anthropic raises at $1.5T'))

    def test_front_page_one_per_story_author_and_link(self):
        lanes = {
            'techmeme': [plain('Reuters', 'Meta releases Muse Spark Open open-weight model', 'https://r.example/a')],
            'x': [x('finkd', 'Muse weights out today', 5, story='Meta releases Muse Spark Open open-weight model', key='techmeme#0'),
                  x('AnthropicAI', 'Evaluators get access', 4, links=['https://www.anthropic.com/news/evals'], key='techmeme#1'),
                  x('AnthropicAI', 'A second post', 3, key='reddit:1')],
            'dev': [plain('Anthropic', 'An update on independent evaluators', 'https://www.anthropic.com/news/evals'),
                    plain('Claude Code releases', 'Claude Code 2.1 released', 'https://github.com/x')],
            'fresh': [],
        }
        page = b.front_page(lanes)
        sources = [i['source'] for i in page]
        self.assertEqual(sources[0], 'Reuters')
        self.assertNotIn('𝕏 @finkd', sources)  # same story as the headline
        self.assertEqual(sources.count('𝕏 @AnthropicAI'), 1)  # one post per author
        self.assertNotIn('Anthropic', sources)  # its article is the post's link
        self.assertIn('Claude Code releases', sources)

    def test_techmeme_files_each_post_under_its_own_story(self):
        story = lambda name, head, handle, post: (
            f'<A NAME="a{name}"></A> <DIV CLASS="itc1"><STRONG><A CLASS="ourh" HREF="https://e.example/{name}">{head}</A></STRONG>'
            f'<SPAN CLASS="drhed">X:</SPAN><A HREF="https://x.com/{handle}/status/{post}">@{handle}</A></DIV>')
        page = ('<DIV CLASS="clus">' + story('261018p9', 'Anthropic news', 'alice', 2111814781766397990) + '</DIV>'
                '<DIV ID="topcol2">sponsor <A HREF="https://x.com/ads/status/2111814781766397991">ad</A></DIV>'
                '<DIV ID="botcol1">' + story('261017p20', 'DeepSeek releases V4.1', 'deepseek_ai', 2111814781766397992) + '</DIV>')
        chunks = b.techmeme_items_html(page)
        self.assertEqual(len(chunks), 2)
        self.assertEqual(b.X_LINK.findall(chunks[0]), [('alice', '2111814781766397990')])
        self.assertEqual(b.X_LINK.findall(chunks[1]), [('deepseek_ai', '2111814781766397992')])

    def test_summary_keeps_whole_sentences_and_drops_links(self):
        text = b.summary('First sentence here. ' * 40 + ' https://t.co/abc', 120)
        self.assertTrue(text.endswith('.'))
        self.assertNotIn('http', text)


if __name__ == '__main__':
    unittest.main()
