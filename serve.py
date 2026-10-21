#!/usr/bin/env python3
"""기타 코드 리듬 — 로컬 서버 + 곡 저장 API

곡(mp3)과 채보는 이 폴더의 songs/ 안에 **파일로** 저장됩니다.
폴더째 복사하면 곡이 전부 따라갑니다.

- 포트는 8799 고정 (주소가 바뀌면 브라우저가 다른 사이트로 봅니다)
- 같은 와이파이의 아이패드에서도 열 수 있도록 0.0.0.0 으로 엽니다
"""
import http.server
import json
import os
import re
import socket
import socketserver
import sys
import urllib.parse
import urllib.request
import webbrowser

DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(DIR)
SONGS_DIR = os.path.join(DIR, 'songs')
MANIFEST = os.path.join(SONGS_DIR, 'songs.json')
PORT = 8799
MARKER = '기타 코드 리듬'
ID_RE = re.compile(r'^[A-Za-z0-9_-]{1,40}$')
AUDIO_EXT = {'mp3', 'm4a', 'wav', 'ogg', 'aac', 'mp4'}
MAX_UPLOAD = 60 * 1024 * 1024


def read_manifest():
    try:
        with open(MANIFEST, encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get('songs'), list):
            return data
    except Exception:
        pass
    return {'format': 'gchord-songs-v1', 'songs': []}


def write_manifest(data):
    os.makedirs(SONGS_DIR, exist_ok=True)
    tmp = MANIFEST + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, MANIFEST)


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    # ---- helpers ----
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body_bytes(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > MAX_UPLOAD:
            return None
        return self.rfile.read(n)

    # ---- routes ----
    def do_GET(self):
        if self.path.split('?')[0] == '/api/ping':
            self.send_json({'ok': True, 'writable': True, 'folder': DIR})
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            if path == '/api/song':
                self.save_song()
            elif path == '/api/audio':
                self.save_audio(query)
            elif path == '/api/delete':
                self.delete_song()
            else:
                self.send_json({'ok': False, 'error': 'unknown-endpoint'}, 404)
        except Exception as exc:                      # noqa: BLE001 - report to the page
            self.send_json({'ok': False, 'error': str(exc)}, 500)

    def save_song(self):
        raw = self.body_bytes()
        if raw is None:
            self.send_json({'ok': False, 'error': 'empty-body'}, 400)
            return
        song = json.loads(raw.decode('utf-8'))
        sid = str(song.get('id', ''))
        if not ID_RE.match(sid):
            self.send_json({'ok': False, 'error': 'bad-id'}, 400)
            return
        data = read_manifest()
        songs = [s for s in data['songs'] if s.get('id') != sid]
        songs.append(song)
        songs.sort(key=lambda s: s.get('title', ''))
        data['songs'] = songs
        write_manifest(data)
        self.send_json({'ok': True, 'song': song})

    def save_audio(self, query):
        sid = (query.get('id') or [''])[0]
        ext = (query.get('ext') or ['mp3'])[0].lower().lstrip('.')
        if not ID_RE.match(sid) or ext not in AUDIO_EXT:
            self.send_json({'ok': False, 'error': 'bad-id-or-ext'}, 400)
            return
        raw = self.body_bytes()
        if raw is None:
            self.send_json({'ok': False, 'error': 'empty-or-too-large'}, 400)
            return
        os.makedirs(SONGS_DIR, exist_ok=True)
        for old in os.listdir(SONGS_DIR):            # one audio file per song id
            stem, dot, oext = old.rpartition('.')
            if stem == sid and oext.lower() in AUDIO_EXT:
                try:
                    os.remove(os.path.join(SONGS_DIR, old))
                except OSError:
                    pass
        name = f'{sid}.{ext}'
        with open(os.path.join(SONGS_DIR, name), 'wb') as f:
            f.write(raw)
        self.send_json({'ok': True, 'audio': name, 'bytes': len(raw)})

    def delete_song(self):
        raw = self.body_bytes()
        sid = json.loads(raw.decode('utf-8')).get('id', '') if raw else ''
        if not ID_RE.match(str(sid)):
            self.send_json({'ok': False, 'error': 'bad-id'}, 400)
            return
        data = read_manifest()
        data['songs'] = [s for s in data['songs'] if s.get('id') != sid]
        write_manifest(data)
        if os.path.isdir(SONGS_DIR):
            for name in os.listdir(SONGS_DIR):
                stem, dot, ext = name.rpartition('.')
                if stem == sid and ext.lower() in AUDIO_EXT:
                    try:
                        os.remove(os.path.join(SONGS_DIR, name))
                    except OSError:
                        pass
        self.send_json({'ok': True})


def already_running(port):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/index.html', timeout=1) as r:
            return MARKER in r.read(4096).decode('utf-8', 'ignore')
    except Exception:
        return False


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    os.makedirs(SONGS_DIR, exist_ok=True)
    if not os.path.exists(MANIFEST):
        write_manifest(read_manifest())

    socketserver.TCPServer.allow_reuse_address = True
    url = f'http://127.0.0.1:{port}/'
    try:
        httpd = socketserver.ThreadingTCPServer(('0.0.0.0', port), Handler)
    except OSError:
        if already_running(port):
            print(f'🎸 이미 실행 중입니다 → {url}')
            webbrowser.open(url)
            return
        print(f'⚠️  {port}번 포트를 다른 프로그램이 쓰고 있습니다.')
        print('   다른 포트로 열면 브라우저가 "다른 사이트"로 보기 때문에')
        print('   설정이 초기화된 것처럼 보일 수 있습니다. 그 프로그램을 닫고 다시 실행해 주세요.')
        sys.exit(1)

    ip = lan_ip()
    print('🎸 기타 코드 리듬 실행 중', flush=True)
    print(f'   이 맥에서:  {url}', flush=True)
    if ip:
        print(f'   아이패드에서(같은 와이파이):  http://{ip}:{port}/', flush=True)
    print(f'   곡 저장 위치: {SONGS_DIR}', flush=True)
    print('   종료하려면 Control+C', flush=True)
    webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n종료합니다.')
    finally:
        httpd.server_close()


if __name__ == '__main__':
    main()
