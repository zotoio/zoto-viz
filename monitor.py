#!/usr/bin/env python3
"""Shim for `python -m service.monitor`. Prefer that; this file stays for old unit files."""
from service.monitor import main

if __name__ == "__main__":
    main()
