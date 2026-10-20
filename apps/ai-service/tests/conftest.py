"""Pytest bootstrap for the AI service test suite.

Prepends the service root (apps/ai-service) to sys.path so test modules can
`import main` and `from <package> import ...` regardless of pytest's
rootdir-based sys.path insertion mode. Individual test files keep their own
SVC_DIR guards as well — belt and suspenders for running a single file from
any working directory.
"""

import os
import sys

SVC_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SVC_DIR not in sys.path:
    sys.path.insert(0, SVC_DIR)
