"""Bounded, read-only aiotieba JSON worker. Credentials never enter responses."""
import asyncio
import contextlib
import hashlib
import inspect
import json
import os
import re
import sys
import unicodedata


class WorkerError(Exception):
    def __init__(self, code, reason):
        self.code, self.reason = code, reason


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def forum_name(value):
    if not isinstance(value, str):
        raise WorkerError('INVALID_FORUM', '吧名必须为文本')
    value = unicodedata.normalize('NFC', value.strip())
    if not 1 <= len(value) <= 100 or re.search(r'[\x00-\x1f\x7f/\\<>?&#=:%]', value):
        raise WorkerError('INVALID_FORUM', '吧名为空、过长或含非法字符')
    return value


def same_name(a, b):
    return a.casefold() == b.casefold()


def classify(error):
    if isinstance(error, WorkerError):
        return error
    if isinstance(error, (asyncio.TimeoutError, TimeoutError)):
        return WorkerError('TIMEOUT', '贴吧只读请求超时')
    if isinstance(error, (ImportError, AttributeError, TypeError)):
        return WorkerError('UNAVAILABLE', 'aiotieba 未安装或接口/返回结构不兼容')
    # Inspect locally, but never expose raw server messages (may include credentials).
    message = str(error).lower()
    status = getattr(error, 'status', getattr(error, 'status_code', None))
    if type(error).__name__ == 'HTTPStatusError':
        status = getattr(error, 'code', status)
    if status == 429 or re.search(r'频繁|限流|rate.limit|too many', message):
        return WorkerError('RATE_LIMITED', '贴吧访问频率受限')
    if status in (401, 403) or re.search(r'登录|权限|验证码|login|captcha|permission|bduss', message):
        return WorkerError('AUTH', '贴吧要求登录或访问许可/人工验证')
    if re.search(r'暂不开放|神秘升级|暂时关闭', message):
        return WorkerError('UNAVAILABLE', '指定贴吧暂不开放，平台拒绝读取')
    if re.search(r'吧不存在|贴吧不存在|未找到该吧|该吧还未建立|forum.*not.*exist', message):
        return WorkerError('INVALID_FORUM', '指定贴吧不存在')
    return WorkerError('NETWORK', '贴吧网络或服务器请求失败')


def checked(rows):
    if getattr(rows, 'err', None) is not None:
        raise classify(rows.err)
    if not hasattr(rows, 'page') or not isinstance(rows.page.has_more, bool):
        raise WorkerError('UNAVAILABLE', 'aiotieba 缺少分页结构')
    return rows


def identity(rows, target, expected=None):
    forum = getattr(rows, 'forum', None)
    name, fid = getattr(forum, 'fname', ''), str(getattr(forum, 'fid', 0))
    if not name or not fid.isdigit() or int(fid) <= 0:
        raise WorkerError('INVALID_FORUM', '接口没有返回有效贴吧标识')
    # Only accept a single trailing display suffix; never rstrip("吧").
    if not (same_name(name, target) or target.endswith('吧') and same_name(name, target[:-1])):
        raise WorkerError('INVALID_FORUM', '返回内容不属于登记贴吧')
    if expected and (fid != str(expected['id']) or not same_name(name, expected['name'])):
        raise WorkerError('INVALID_FORUM', '贴吧标识变化，需管理员检查来源')
    return {'id': fid, 'name': name}


def number(value, minimum=1, maximum=1000000):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise WorkerError('UNAVAILABLE', '阅读游标无效')
    return value


def stable_id(value):
    value = str(value)
    if not re.fullmatch(r'[1-9][0-9]{0,24}', value):
        raise WorkerError('UNAVAILABLE', '接口缺少有效的稳定内容 ID')
    return value


def contract(client):
    for method, args, kwargs in [('get_threads', ('x',), {'pn': 1, 'rn': 20}),
                                 ('get_posts', (1,), {'pn': 1, 'rn': 10, 'with_comments': False}),
                                 ('get_comments', (1, 1), {'pn': 1})]:
        try:
            inspect.signature(getattr(client, method)).bind(*args, **kwargs)
        except (TypeError, AttributeError, ValueError):
            raise WorkerError('UNAVAILABLE', 'aiotieba 只读方法签名不兼容')


async def threads(client, target, page, expected):
    try:
        rows = checked(await client.get_threads(target, pn=page, rn=20))
        return rows, identity(rows, target, expected)
    except WorkerError as error:
        if error.code != 'INVALID_FORUM' or not target.endswith('吧') or len(target) <= 1 or expected:
            raise
    rows = checked(await client.get_threads(target[:-1], pn=page, rn=20))
    return rows, identity(rows, target, expected)


def page_signature(rows):
    return digest('|'.join(stable_id(getattr(r, 'pid', getattr(r, 'tid', None))) for r in rows))


async def execute(req):
    import aiotieba
    target = forum_name(req.get('target'))
    action = req.get('action')
    if action not in ('probe', 'discover', 'read'):
        raise WorkerError('UNAVAILABLE', '不支持的只读操作')
    async with aiotieba.Client(os.environ.get('QQ_COMMUNITY_CREDENTIAL', '')) as client:
        contract(client)
        expected = req.get('forum')
        if action in ('probe', 'discover'):
            state = req.get('cursor') or {}
            if isinstance(state, str):
                state = json.loads(state)
            if isinstance(state, int):  # Old discovery cursor.
                state = {'page': max(1, state)}
            page = 1 if action == 'probe' else number(state.get('page', 1), maximum=50)
            rows, forum = await threads(client, target, page, expected)
            if action == 'probe':
                return {'ready': True, 'forum': forum, 'version': str(getattr(aiotieba, '__version__', 'unknown'))}
            signature = page_signature(rows)
            repeated = signature in state.get('seen', [])
            more = bool(rows) and rows.page.has_more and not repeated and page < 50
            items = []
            for row in ([] if repeated else rows):
                tid = stable_id(row.tid)
                if getattr(row, 'fid', int(forum['id'])) != int(forum['id']):
                    raise WorkerError('INVALID_FORUM', '帖子不属于登记贴吧')
                items.append({'id': tid, 'title': row.title[:200], 'summary': row.text[:400],
                              'forum': forum, 'url': 'https://tieba.baidu.com/p/' + tid,
                              'publishedAt': int(row.create_time) * 1000 if row.create_time else 0,
                              'replyCount': getattr(row, 'reply_num', None),
                              'lastReplyAt': getattr(row, 'last_time', None), 'stableThread': True})
            cursor = {'page': page + 1, 'seen': [*state.get('seen', []), signature]} if more else {'page': 1}
            return {'items': items, 'forum': forum, 'cursor': cursor, 'hasMore': more,
                    'paginationStopped': 'REPEATED_PAGE' if repeated else 'BOUND_REACHED' if page == 50 and rows.page.has_more else None}
        tid = stable_id(req['id'])
        state = req.get('cursor') or {'stage': 'floors', 'page': 1, 'itemIndex': 0}
        # Accept old worker checkpoints without discarding position.
        if 'parents' in state:
            state = {**state, 'stage': 'replies', 'floorPid': state['parents'][0]}
        stage = state.get('stage', 'floors')
        if stage not in ('floors', 'replies'):
            raise WorkerError('UNAVAILABLE', '阅读阶段无效')
        page = number(state.get('page', 1))
        index = number(state.get('itemIndex', 0), 0, 100)
        offset = number(state.get('offset', 0), 0, 10000000)
        if stage == 'floors':
            rows = checked(await client.get_posts(int(tid), pn=page, rn=10, with_comments=False))
        else:
            pid = stable_id(state['floorPid'])
            rows = checked(await client.get_comments(int(tid), int(pid), pn=number(state.get('replyPage', 1))))
        forum = identity(rows, target, expected)
        if str(getattr(rows.thread, 'tid', '')) != tid:
            raise WorkerError('INVALID_FORUM', '返回主题帖 ID 不匹配')
        signature = page_signature(rows)
        stopped = None
        if index == 0 and offset == 0 and signature in state.get('seen', []):
            rows = []
            stopped = 'REPEATED_PAGE'
        if index > len(rows):
            raise WorkerError('UNAVAILABLE', '页内位置已变化，请重试检查')
        def after_page():
            if rows and rows.page.has_more:
                if stage == 'floors':
                    return {'stage': 'floors', 'page': page + 1, 'itemIndex': 0,
                            'seen': [*state.get('seen', []), signature][-50:]}
                return {**state, 'replyPage': state.get('replyPage', 1) + 1,
                        'itemIndex': 0, 'offset': 0, 'seen': [*state.get('seen', []), signature][-50:]}
            if stage == 'replies':
                if len(state.get('parents', [])) > 1:
                    return {**state, 'parents': state['parents'][1:], 'floorPid': state['parents'][1],
                            'replyPage': 1, 'itemIndex': 0, 'offset': 0, 'seen': []}
                return state.get('next')
            return None
        if not rows or index == len(rows):
            nxt = after_page()
            return {'text': '', 'records': [], 'contentType': stage, 'readCursor': nxt,
                    'complete': nxt is None, 'paginationStopped': stopped or 'EMPTY_PAGE', 'forum': forum}
        row = rows[index]
        pid = stable_id(row.pid) if stage == 'floors' else stable_id(state['floorPid'])
        reply = stable_id(row.pid) if stage == 'replies' else None
        if str(getattr(row, 'tid', tid)) != tid or stage == 'replies' and str(row.ppid) != pid:
            raise WorkerError('INVALID_FORUM', '楼层或回复关联不匹配')
        text = row.text
        if not isinstance(text, str) or offset > len(text):
            raise WorkerError('UNAVAILABLE', '正文结构或文本偏移无效')
        full_hash = digest(text)
        if offset and state.get('itemHash') != full_hash:
            offset = 0  # Edited while reading: resume from a stable content version.
        end = min(len(text), offset + 2400)
        part = text[offset:end]
        nxt = {**state, 'stage': stage, 'itemIndex': index + 1, 'offset': 0}
        if end < len(text):
            nxt.update(itemIndex=index, offset=end, itemHash=full_hash)
        else:
            if index + 1 == len(rows):
                nxt = after_page()
            if stage == 'floors' and getattr(row, 'reply_num', 0) > 0:
                nxt = {'stage': 'replies', 'page': page, 'floorPid': pid, 'replyPage': 1,
                       'itemIndex': 0, 'next': nxt}
        record = {'tid': tid, 'pid': pid, 'replyId': reply, 'parentPid': pid if reply else None,
                  'floorNumber': getattr(row, 'floor', None), 'contentType': stage,
                  'offset': offset, 'end': end, 'itemComplete': end == len(text),
                  'contentHash': digest(part), 'itemHash': full_hash, 'text': part}
        label = f'帖子{tid}/楼层{pid}' + (f'/回复{reply}（独立发言，父楼层{pid}）' if reply else '（独立楼层发言）')
        # Labels contain no author identity; original text stays verbatim for quote validation.
        return {'text': label + ': ' + part, 'records': [record], 'forum': forum,
                'contentType': stage, 'readCursor': nxt, 'complete': nxt is None}


if __name__ == '__main__':
    try:
        sys.stdin.reconfigure(encoding='utf-8')
        sys.stdout.reconfigure(encoding='utf-8')
        raw = sys.stdin.readline(32769)
        if len(raw) > 32768:
            raise WorkerError('UNAVAILABLE', '请求超过大小保护')
        # Libraries may log to stdout; reserve stdout exclusively for our JSON contract.
        with contextlib.redirect_stdout(sys.stderr):
            result = asyncio.run(asyncio.wait_for(execute(json.loads(raw)), timeout=25))
    except Exception as error:
        failure = classify(error)
        result = {'error': failure.code, 'reason': failure.reason}
    print(json.dumps(result, ensure_ascii=False), flush=True)
