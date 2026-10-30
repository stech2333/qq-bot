"""Offline contract fixtures: no network, credentials or production data."""
import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('worker', Path(__file__).with_name('community-tieba.py'))
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
NS = types.SimpleNamespace


class Rows(list):
    def __init__(self, values=(), more=False, forum='Minecraft', error=None):
        super().__init__(values)
        self.err = error
        self.page = NS(has_more=more)
        self.forum = NS(fname=forum, fid=1)
        self.thread = NS(tid=123)


def post(pid=8, text='摸鱼在这里指工作间隙偷闲。', replies=0):
    return NS(pid=pid, tid=123, ppid=8, text=text, reply_num=replies, floor=pid)


class Client:
    thread_pages, floor_pages, reply_pages, calls = {}, {}, {}, []
    def __init__(self, *_): pass
    async def __aenter__(self): return self
    async def __aexit__(self, *_): pass
    async def get_threads(self, name, pn=1, *, rn=30):
        self.calls.append(('threads', name, pn))
        if name not in ('Minecraft', 'Minecraft吧', '真吧'):
            raise w.WorkerError('INVALID_FORUM', '贴吧不存在')
        return self.thread_pages.get(pn, Rows(forum='真吧' if name == '真吧' else 'Minecraft'))
    async def get_posts(self, tid, pn=1, *, rn=30, with_comments=False):
        self.calls.append(('posts', tid, pn))
        return self.floor_pages.get(pn, Rows())
    async def get_comments(self, tid, pid, pn=1):
        self.calls.append(('comments', tid, pid, pn))
        return self.reply_pages.get((pid, pn), Rows())


class WorkerTests(unittest.TestCase):
    def setUp(self):
        sys.modules['aiotieba'] = NS(Client=Client, __version__='fixture')
        Client.thread_pages, Client.floor_pages, Client.reply_pages, Client.calls = {}, {}, {}, []
    def run_request(self, action='read', **kw):
        return asyncio.run(w.execute(dict(action=action, target='Minecraft', id='123', **kw)))
    def test_legal_name_and_probe(self):
        self.assertTrue(self.run_request('probe')['ready'])
    def test_illegal_names(self):
        for name in ('', ' ', 'a/b', 'a\nb', 'x'*101, 'https://x'):
            with self.assertRaises(w.WorkerError): w.forum_name(name)
    def test_missing_forum(self):
        with self.assertRaises(w.WorkerError) as e:
            asyncio.run(w.execute({'action':'probe','target':'不存在的合成测试吧'}))
        self.assertEqual(e.exception.code, 'INVALID_FORUM')
    def test_single_suffix_and_real_name_preserved(self):
        self.assertEqual(asyncio.run(w.execute({'action':'probe','target':'Minecraft吧'}))['forum']['name'], 'Minecraft')
        self.assertEqual(asyncio.run(w.execute({'action':'probe','target':'真吧'}))['forum']['name'], '真吧')
    def test_mismatched_forum(self):
        Client.floor_pages[1] = Rows([post()], forum='其他')
        with self.assertRaises(w.WorkerError): self.run_request()
    def test_forum_id_binding(self):
        with self.assertRaises(w.WorkerError): self.run_request('probe', forum={'id':'999','name':'Minecraft'})
    def test_discovery_metadata_and_stable_identity(self):
        row = NS(tid=123, title='合成测试标题', text='摘要', create_time=1, reply_num=2, last_time=3, fid=1)
        Client.thread_pages[1] = Rows([row], more=True)
        a = self.run_request('discover')
        self.assertEqual(a['items'][0]['url'], 'https://tieba.baidu.com/p/123')
        self.assertTrue(a['items'][0]['stableThread'])
        self.assertNotIn('revision', a['items'][0])
        Client.thread_pages[2] = Rows([NS(**{**vars(row), 'tid':124})])
        b = self.run_request('discover', cursor=a['cursor'])
        self.assertEqual(b['items'][0]['id'], '124')
        self.assertFalse(b['hasMore'])
    def test_repeated_discovery_page(self):
        Client.thread_pages[1] = Client.thread_pages[2] = Rows([NS(tid=123,title='标题',text='',create_time=0)],more=True)
        a = self.run_request('discover')
        b = self.run_request('discover', cursor=a['cursor'])
        self.assertFalse(b['hasMore']); self.assertEqual(b['items'], [])
    def test_floor_and_reply_pages_restore_floor_position(self):
        Client.floor_pages[1] = Rows([post(replies=2),post(9)],more=True)
        Client.floor_pages[2] = Rows([post(10)])
        Client.reply_pages[8,1] = Rows([post(81)],more=True)
        Client.reply_pages[8,2] = Rows([post(82)])
        cursor, records = None, []
        for _ in range(12):
            r = self.run_request(cursor=cursor);records.extend(r['records'])
            cursor = json_roundtrip(r['readCursor'])
            if r['complete']: break
        self.assertTrue(r['complete'])
        self.assertEqual([(x['pid'],x['replyId']) for x in records], [('8',None),('8','81'),('8','82'),('9',None),('10',None)])
    def test_long_floor_and_reply_no_truncation(self):
        text = '长正文🦈'*5000
        for replies in (False, True):
            Client.floor_pages[1] = Rows([post(text=text,replies=0)])
            Client.reply_pages[8,1] = Rows([post(81,text=text)])
            cursor = {'stage':'replies','page':1,'floorPid':'8','replyPage':1,'next':None} if replies else None
            parts=[]
            for _ in range(80):
                r=self.run_request(cursor=cursor);parts.extend(x['text'] for x in r['records']);cursor=json_roundtrip(r['readCursor'])
                self.assertLessEqual(len(r['text'].encode('utf-16-le'))//2, 16000)
                if r['complete']: break
            self.assertTrue(r['complete']);self.assertEqual(''.join(parts),text)
    def test_empty_page_terminates(self):
        Client.floor_pages[1] = Rows([],more=True)
        r=self.run_request(); self.assertTrue(r['complete']);self.assertEqual(r['paginationStopped'],'EMPTY_PAGE')
    def test_repeat_floor_page_terminates(self):
        Client.floor_pages[1]=Client.floor_pages[2]=Rows([post()],more=True)
        a=self.run_request();b=self.run_request(cursor=a['readCursor'])
        self.assertTrue(b['complete']);self.assertEqual(b['paginationStopped'],'REPEATED_PAGE')
    def test_invalid_cursor(self):
        for cursor in ({'page':0},{'page':-1},{'page':1,'stage':'write'},{'page':1,'offset':-3}):
            with self.assertRaises(w.WorkerError): self.run_request(cursor=cursor)
    def test_relation_mismatch_rejected(self):
        x=post(81);x.ppid=999;Client.reply_pages[8,1]=Rows([x])
        with self.assertRaises(w.WorkerError):self.run_request(cursor={'stage':'replies','floorPid':'8'})
    def test_thread_mismatch_rejected(self):
        rows=Rows([post()]);rows.thread.tid=456;Client.floor_pages[1]=rows
        with self.assertRaises(w.WorkerError):self.run_request()
    def test_no_synthetic_id(self):
        Client.floor_pages[1]=Rows([post(0)])
        with self.assertRaises(w.WorkerError):self.run_request()
    def test_edit_during_chunk_restores_version_boundary(self):
        Client.floor_pages[1]=Rows([post(text='甲'*6000)])
        a=self.run_request();Client.floor_pages[1]=Rows([post(text='乙'*6000)])
        b=self.run_request(cursor=a['readCursor']);self.assertEqual(b['records'][0]['offset'],0)
    def test_error_categories(self):
        class HTTPStatusError(RuntimeError):
            code = 429
        for error,code in [(TimeoutError(),'TIMEOUT'),(ImportError(),'UNAVAILABLE'),(TypeError(),'UNAVAILABLE'),(Exception('请登录'),'AUTH'),(Exception('频繁访问'),'RATE_LIMITED'),(HTTPStatusError('request failed'),'RATE_LIMITED'),(Exception('抱歉，该吧神秘升级中，暂不开放'),'UNAVAILABLE'),(Exception('该吧还未建立，去看看其他贴吧吧'),'INVALID_FORUM'),(Exception('network down'),'NETWORK')]:
            self.assertEqual(w.classify(error).code,code)
    def test_server_error_preserved(self):
        Client.floor_pages[1]=Rows(error=TimeoutError())
        with self.assertRaises(w.WorkerError) as e:self.run_request()
        self.assertEqual(e.exception.code,'TIMEOUT')
    def test_incompatible_signature(self):
        class Incompatible(Client):
            async def get_posts(self, tid): pass
        sys.modules['aiotieba'].Client=Incompatible
        with self.assertRaises(w.WorkerError) as e:self.run_request('probe')
        self.assertEqual(e.exception.code,'UNAVAILABLE')
    def test_cancel_not_swallowed(self):
        class Cancelled(Client):
            async def get_posts(self,*args,**kwargs):raise asyncio.CancelledError()
        sys.modules['aiotieba'].Client=Cancelled
        with self.assertRaises(asyncio.CancelledError):self.run_request()
    def test_read_only_actions(self):
        for action in ('post','like','follow','sign','delete'):
            with self.assertRaises(w.WorkerError):self.run_request(action)


def json_roundtrip(value):
    import json
    return json.loads(json.dumps(value))


if __name__ == '__main__':
    if '--worker' in sys.argv:
        import json
        sys.stdin.reconfigure(encoding='utf-8')
        sys.stdout.reconfigure(encoding='utf-8')
        sys.modules['aiotieba'] = NS(Client=Client, __version__='fixture')
        Client.thread_pages = {1:Rows([NS(tid=123,title='合成离线测试：摸鱼',text='工作休息文化',create_time=1,reply_num=2,last_time=3,fid=1)])}
        Client.floor_pages = {1:Rows([post(replies=1)])}
        Client.reply_pages = {(8,1):Rows([post(81)])}
        try:
            print(json.dumps(asyncio.run(w.execute(json.loads(sys.stdin.readline()))),ensure_ascii=False))
        except Exception as e:
            error=w.classify(e);print(json.dumps({'error':error.code,'reason':error.reason}))
    else:
        unittest.main()
