#!/usr/bin/env python3
"""
Local preview server for the SportsPred site.

Serves the repository root so that index.html, engine/, data/ and assets/ all
resolve exactly as they do when GitHub Pages publishes the root. Dotfiles and
dot-directories (.git, .github) are refused rather than served.

Usage: python3 scripts/serve.py [port]
"""
import sys
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def translate_path(self, path):
        # Refuse anything that reaches into a dot-directory (.git, .github, ...).
        cleaned = path.split('?', 1)[0].split('#', 1)[0]
        if any(part.startswith('.') and part not in ('.', '..') for part in cleaned.split('/')):
            return os.path.join(ROOT, '404-refused')
        return super().translate_path(path)

    def end_headers(self):
        # ESM modules need a correct MIME type; SimpleHTTPRequestHandler infers
        # .mjs correctly on modern Python but be explicit.
        if self.path.endswith('.mjs'):
            self.send_header('Content-Type', 'text/javascript; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    print(f"Serving {ROOT} on 0.0.0.0:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
