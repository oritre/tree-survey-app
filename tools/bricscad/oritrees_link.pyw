"""Tree survey app -> BricsCAD: "show in BricsCAD" button.

The web app asks for tree <num> (button next to the designation in a construction tree card, or a double-click on a
tree in the list). This script sends BricsCAD the same thing a double-click on a tree number in the Excel does:
(ts:xlgo "<num>") as a WM_COPYDATA message (BricsCAD has no COM registration on this PC, and unsigned exe/dll files
are blocked, so the bridge is pythonw). The same tree again = the next copy of the "trees" block (ts:xlgo does that).

Two ways in, the fast one first:
  1. a small helper that stays running and listens on http://127.0.0.1:47613/go/<num> (instant). It starts at
     Windows sign-in (HKCU Run) and also by itself after the first link click.
  2. the link oritrees://go/<num>: Windows starts this script (about 1 s on this PC: starting a process is slow),
     which jumps and then stays running as the helper, so the next click is instant.

Install once (copies itself to %LOCALAPPDATA%\\OriTrees, registers the link and the sign-in start for this Windows
user, no admin, and starts the helper):
    python.exe oritrees_link.pyw --install
Remove:
    python.exe oritrees_link.pyw --uninstall
"""
import ctypes
import ctypes.wintypes as wt
import os
import subprocess
import sys
import urllib.parse

SCHEME = 'oritrees'
PORT = 47613
ORIGINS = ('https://oritre.github.io',)   # only the survey app may call the helper
RUN_NAME = 'OriTreesLink'
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(os.environ.get('TEMP', HERE), 'oritrees_link.log')

# where trees.lsp may be, when it is not loaded in the drawing yet
LSP_CANDIDATES = [
    'G:\\\u05d4\u05d0\u05d7\u05e1\u05d5\u05df \u05e9\u05dc\u05d9\\PyCharmMiscProject\\bricscad\\trees.lsp',
    'G:\\\u05d4\u05d0\u05d7\u05e1\u05d5\u05df \u05e9\u05dc\u05d9\\PyCharmMiscProject\\trees.lsp',
    os.path.join(os.environ.get('APPDATA', ''), r'Bricsys\BricsCAD\V26x64\en_US\Support\OriTools\trees.lsp'),
    os.path.join(HERE, 'trees.lsp'),
]


def log(msg):
    try:
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(msg + '\n')
    except OSError:
        pass


def pythonw():
    exe = sys.executable
    return exe[:-10] + 'pythonw.exe' if exe.lower().endswith('python.exe') else exe


def install():
    import shutil
    import winreg
    dst_dir = os.path.join(os.environ['LOCALAPPDATA'], 'OriTrees')
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, 'oritrees_link.pyw')
    if os.path.abspath(__file__).lower() != dst.lower():
        shutil.copyfile(os.path.abspath(__file__), dst)
    exe = pythonw()
    cmd = f'"{exe}" -I -S "{dst}" "%1"'
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf'Software\Classes\{SCHEME}') as k:
        winreg.SetValueEx(k, '', 0, winreg.REG_SZ, 'URL:Tree survey -> BricsCAD')
        winreg.SetValueEx(k, 'URL Protocol', 0, winreg.REG_SZ, '')
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf'Software\Classes\{SCHEME}\shell\open\command') as k:
        winreg.SetValueEx(k, '', 0, winreg.REG_SZ, cmd)
    run = f'"{exe}" -I -S "{dst}" --serve'
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run') as k:
        winreg.SetValueEx(k, RUN_NAME, 0, winreg.REG_SZ, run)
    subprocess.Popen([exe, '-I', '-S', dst, '--serve'], close_fds=True, creationflags=0x08000000)   # CREATE_NO_WINDOW
    log('installed: ' + cmd + ' | run: ' + run)
    print('link:', cmd)
    print('sign-in start:', run)
    print('helper started on http://127.0.0.1:%d' % PORT)


def uninstall():
    import winreg
    for sub in (r'\shell\open\command', r'\shell\open', r'\shell', ''):
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, rf'Software\Classes\{SCHEME}{sub}')
        except OSError:
            pass
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run', 0, winreg.KEY_SET_VALUE) as k:
            winreg.DeleteValue(k, RUN_NAME)
    except OSError:
        pass
    try:
        import urllib.request
        urllib.request.urlopen(f'http://127.0.0.1:{PORT}/quit', timeout=1)
    except Exception:
        pass
    print('removed')


user32 = ctypes.WinDLL('user32', use_last_error=True) if os.name == 'nt' else None


class COPYDATASTRUCT(ctypes.Structure):
    _fields_ = [('dwData', ctypes.c_size_t), ('cbData', wt.DWORD), ('lpData', ctypes.c_void_p)]


def find_bricscad():
    """the visible top-level BricsCAD main window (title 'BricsCAD ... - [drawing]')"""
    found = []
    WNDENUMPROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

    def cb(hwnd, _):
        if not user32.IsWindowVisible(hwnd) or user32.GetWindow(hwnd, 4):   # GW_OWNER: skip dialogs
            return True
        n = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        if buf.value.startswith('BricsCAD'):
            found.append(hwnd)
        return True
    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return found[0] if found else None


def lisp_str(s):
    return '"' + s.replace('\\', '/').replace('"', '') + '"'


def front(hwnd):
    """bring BricsCAD forward. A background helper may not take the foreground, so tap Alt first (the usual
    Windows workaround); if it still fails, the zoom happens anyway and the taskbar button flashes"""
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)   # SW_RESTORE
    if user32.GetForegroundWindow() == hwnd:
        return
    user32.keybd_event(0x12, 0, 0, 0)       # Alt down
    user32.keybd_event(0x12, 0, 2, 0)       # Alt up
    user32.SetForegroundWindow(hwnd)


def go(num, box=True):
    """returns '' when sent, else the reason"""
    hwnd = find_bricscad()
    if not hwnd:
        if box:
            user32.MessageBoxW(None, 'BricsCAD לא פתוח.', 'סקר עצים', 0x40030)
        return 'BricsCAD is not open'
    lsp = next((p for p in LSP_CANDIDATES if os.path.isfile(p)), None)
    load = f'(if (and (null ts:xlgo) (findfile {lisp_str(lsp)})) (load {lisp_str(lsp)}))' if lsp else ''
    # two Esc first (like the Excel add-in) so a running command does not swallow the line
    cmd = '\x03\x03' + f'(progn {load}(if ts:xlgo (ts:xlgo {lisp_str(num)}) (princ "\\nRun TREES once in this drawing.")) (princ))\n'
    buf = ctypes.create_unicode_buffer(cmd)
    cds = COPYDATASTRUCT(1, ctypes.sizeof(buf), ctypes.cast(buf, ctypes.c_void_p))
    front(hwnd)
    user32.SendMessageW(hwnd, 0x4A, 0, ctypes.byref(cds))
    log(f'go {num} -> {hwnd}')
    return ''


def clean_num(s):
    return ''.join(ch for ch in s if ch.isalnum() or ch in '-_.')


def serve():
    """the helper: http://127.0.0.1:PORT/go/<num>. Only one runs (the port is taken by the first)."""
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class H(BaseHTTPRequestHandler):
        def cors(self, code):
            self.send_response(code)
            self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin') if self.headers.get('Origin') in ORIGINS else ORIGINS[0])
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Access-Control-Allow-Methods', 'GET')
            self.send_header('Cache-Control', 'no-store')

        def do_OPTIONS(self):
            self.cors(204)
            self.end_headers()

        def do_GET(self):
            parts = [urllib.parse.unquote(p) for p in self.path.split('?')[0].split('/') if p]
            origin = self.headers.get('Origin')
            # /go only from the app's own site (a browser always sends Origin on fetch); /quit only from this PC's
            # uninstall (no Origin). Anything else: 403
            if not ((parts[:1] == ['go'] and origin in ORIGINS) or (parts[:1] == ['quit'] and origin is None and not self.headers.get('Referer'))):
                self.cors(403)
                self.end_headers()
                return
            msg = 'ok'
            if parts[:1] == ['go'] and len(parts) > 1 and clean_num(parts[1]):
                msg = go(clean_num(parts[1]), box=False) or 'ok'
            elif parts[:1] == ['quit']:
                msg = 'bye'
            body = msg.encode()
            self.cors(200 if msg in ('ok', 'bye') else 503)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            if msg == 'bye':
                os._exit(0)

        def log_message(self, *a):
            pass

    try:
        srv = HTTPServer(('127.0.0.1', PORT), H)
    except OSError:
        return   # already running
    log('helper listening on %d' % PORT)
    srv.serve_forever()


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    if args[0] == '--install':
        install()
        return
    if args[0] == '--uninstall':
        uninstall()
        return
    if args[0] == '--serve':
        serve()
        return
    # oritrees://go/12  (Chrome may add a trailing slash)
    u = urllib.parse.urlparse(args[0])
    parts = [urllib.parse.unquote(p) for p in (u.netloc + u.path).split('/') if p]
    if len(parts) >= 2 and parts[0] == 'go' and clean_num(parts[1]):
        go(clean_num(parts[1]))
    else:
        log('unknown link: ' + args[0])
    serve()   # stay as the helper (returns at once if one already runs), so the next click is instant


if __name__ == '__main__':
    try:
        main()
    except Exception as e:   # pythonw has no console: keep a trace
        log('error: ' + repr(e))
