#!/usr/bin/env python3
"""mic2midi launcher: serves this folder on a random localhost port, opens it as a
standalone Chrome app window (no tabs/URL bar), and exits when you close the window.
Needs Chrome/Chromium/Edge installed; no pip packages."""
import functools, http.server, pathlib, shutil, subprocess, sys, threading

here = pathlib.Path(__file__).resolve().parent

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(here)))
threading.Thread(target=srv.serve_forever, daemon=True).start()

browser = next((b for n in ("google-chrome", "chromium", "chromium-browser", "microsoft-edge") if (b := shutil.which(n))), None)
if not browser:
    sys.exit("mic2midi: need google-chrome, chromium or microsoft-edge on PATH")

# own profile dir => its own process (so we can wait on it) and mic permission is remembered
profile = pathlib.Path.home() / ".cache" / "mic2midi-profile"
subprocess.run([browser, f"--app=http://127.0.0.1:{srv.server_port}/index.html", f"--user-data-dir={profile}",
                "--window-size=1100,900", "--no-first-run", "--no-default-browser-check"])
