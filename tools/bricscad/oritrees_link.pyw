"""Tree survey app -> BricsCAD: "show in BricsCAD" button.

The web app opens a link  oritrees://go/<tree number>  (button next to the designation in a construction tree card).
Windows starts this script with the link; it sends BricsCAD the same thing a double-click on a tree number in the
Excel does: (ts:xlgo "<num>") as a WM_COPYDATA message (BricsCAD has no COM registration on this PC, and
unsigned exe/dll files are blocked, so the bridge is pythonw + a small registry entry).
The same tree again = the next copy of the "trees" block (ts:xlgo does that).

oritrees://sync (app 1.95.0): the app just wrote the survey file for BricsCAD; BricsCAD draws again ((ts:cadsync)).
No Esc and no focus change: the app's window stays in front, and a running command is not cancelled (inside a
command ts:cadsync waits for its end).

Install once (registers the oritrees: link for this Windows user, no admin):
    pythonw.exe oritrees_link.pyw --install
Remove:
    pythonw.exe oritrees_link.pyw --uninstall
"""
import ctypes
import ctypes.wintypes as wt
import os
import sys
import urllib.parse

SCHEME = 'oritrees'
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(os.environ.get('TEMP', HERE), 'oritrees_link.log')

# where trees.lsp may be, when it is not loaded in the drawing yet
LSP_CANDIDATES = [
    os.path.join(HERE, 'trees.lsp'),
    os.path.join(os.environ.get('APPDATA', ''), r'Bricsys\BricsCAD\V26x64\en_US\Support\OriTools\trees.lsp'),
    'G:\\\u05d4\u05d0\u05d7\u05e1\u05d5\u05df \u05e9\u05dc\u05d9\\PyCharmMiscProject\\bricscad\\trees.lsp',
    'G:\\\u05d4\u05d0\u05d7\u05e1\u05d5\u05df \u05e9\u05dc\u05d9\\PyCharmMiscProject\\trees.lsp',
]


def log(msg):
    try:
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(msg + '\n')
    except OSError:
        pass


def install():
    import winreg
    exe = sys.executable
    if exe.lower().endswith('python.exe'):
        exe = exe[:-10] + 'pythonw.exe'
    cmd = f'"{exe}" "{os.path.abspath(__file__)}" "%1"'
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf'Software\Classes\{SCHEME}') as k:
        winreg.SetValueEx(k, '', 0, winreg.REG_SZ, 'URL:Tree survey -> BricsCAD')
        winreg.SetValueEx(k, 'URL Protocol', 0, winreg.REG_SZ, '')
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf'Software\Classes\{SCHEME}\shell\open\command') as k:
        winreg.SetValueEx(k, '', 0, winreg.REG_SZ, cmd)
    log('installed: ' + cmd)
    print('installed:', cmd)


def uninstall():
    import winreg
    for sub in (r'\shell\open\command', r'\shell\open', r'\shell', ''):
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, rf'Software\Classes\{SCHEME}{sub}')
        except OSError:
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


def go(num):
    hwnd = find_bricscad()
    if not hwnd:
        user32.MessageBoxW(None, 'BricsCAD לא פתוח.', 'סקר עצים', 0x40030)
        return
    lsp = next((p for p in LSP_CANDIDATES if os.path.isfile(p)), None)
    load = f'(if (and (null ts:xlgo) {lisp_str(lsp)} (findfile {lisp_str(lsp)})) (load {lisp_str(lsp)}))' if lsp else ''
    # two Esc first (like the Excel add-in) so a running command does not swallow the line
    cmd = '\x03\x03' + f'(progn {load}(if ts:xlgo (ts:xlgo {lisp_str(num)}) (princ "\\nRun TREES once in this drawing.")) (princ))\n'
    buf = ctypes.create_unicode_buffer(cmd)
    cds = COPYDATASTRUCT(1, ctypes.sizeof(buf), ctypes.cast(buf, ctypes.c_void_p))
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)   # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    user32.SendMessageW(hwnd, 0x4A, 0, ctypes.byref(cds))
    log(f'go {num} -> {hwnd}')


def sync():
    hwnd = find_bricscad()
    if not hwnd:
        return
    send(hwnd, '(if ts:cadsync (ts:cadsync))\n')
    log(f'sync -> {hwnd}')


def send(hwnd, cmd):
    buf = ctypes.create_unicode_buffer(cmd)
    cds = COPYDATASTRUCT(1, ctypes.sizeof(buf), ctypes.cast(buf, ctypes.c_void_p))
    user32.SendMessageW(hwnd, 0x4A, 0, ctypes.byref(cds))


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
    # oritrees://go/12?x=1  (Chrome may add a trailing slash)
    u = urllib.parse.urlparse(args[0])
    parts = [urllib.parse.unquote(p) for p in (u.netloc + u.path).split('/') if p]
    if parts and parts[0] == 'sync':
        sync()
    elif len(parts) >= 2 and parts[0] == 'go':
        num = ''.join(ch for ch in parts[1] if ch.isalnum() or ch in '-_.')
        if num:
            go(num)
    else:
        log('unknown link: ' + args[0])


if __name__ == '__main__':
    try:
        main()
    except Exception as e:   # pythonw has no console: keep a trace
        log('error: ' + repr(e))
