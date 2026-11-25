#!/usr/bin/python3 -I
"""This project's public-copy check (CHECK_SCRIPT in private/release.conf).

It is the release kit's own pattern check (emails, MAC addresses, IP addresses) with a wider IP
allow-list, because a network planner's examples and docs need real-looking private ranges and must
name the special ranges it warns about:

  * every private (RFC 1918) address: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  * the special ranges ipplan checks for: 0.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16, 100.64.0.0/10,
    224.0.0.0/4 and 240.0.0.0/4
  * everything the kit already allows (documentation ranges, loopback, a few well-known resolvers)

Public addresses outside those still fail. The owner's own networks are blocked by the private word
list, which the release build applies to every file; they are never written here, because this
script is published.

Usage: python3 -I scripts/check_public.py DIR
"""
import ipaddress
import os
import sys

sys.dont_write_bytecode = True                    # never leave __pycache__ in the release kit
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "release"))
import check_patterns  # noqa: E402  (the kit's scanner)

EXTRA_NETS = [ipaddress.ip_network(n) for n in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
    "0.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "100.64.0.0/10", "224.0.0.0/4", "240.0.0.0/4")]

_kit_ip_ok = check_patterns.Scanner.ip_ok


def ip_ok(ip):
    if ip.version == 4 and any(ip in n for n in EXTRA_NETS):
        return True
    return _kit_ip_ok(ip)


check_patterns.Scanner.ip_ok = staticmethod(ip_ok)

SKIP_DIRS = {".git", "node_modules", "private", ".wrangler"}


def main(argv):
    root = os.path.abspath(argv[1] if len(argv) > 1 else os.path.dirname(HERE))
    if not os.path.isdir(root):
        print("check_public: the directory to check does not exist")
        return 1
    scanner = check_patterns.Scanner(())
    problems, scanned = [], 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, root).replace(os.sep, "/")
            for _line, kind in scanner.scan_text(rel):
                problems.append("a file name: %s" % kind)      # never print the name itself
            try:
                with open(path, "rb") as f:
                    text = f.read().decode("utf-8")
            except (OSError, UnicodeDecodeError):
                continue                                      # binaries are the kit's job
            scanned += 1
            for line, kind in scanner.scan_text(text):
                problems.append("%s:%d: %s not allowed in public files" % (rel, line, kind))
    if not scanned:
        problems.append("no files were checked")
    for p in problems:
        print(p)
    print("check_public: %s" % ("%d problem(s)" % len(problems) if problems else "OK"))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
