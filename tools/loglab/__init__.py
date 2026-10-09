"""Offline, standard-library-only log investigation. No collectors or network calls."""

from .core import ImportError, parse_logs
from .rules import analyze_events

__all__ = ["ImportError", "parse_logs", "analyze_events"]
