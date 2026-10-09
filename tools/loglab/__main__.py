"""Usage: python -m tools.loglab --db logs/private.sqlite <init|import|analyze|report>."""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

from .core import ImportError, read_logs
from .report import markdown_report
from .storage import analyze_database, connect, import_dataset


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline candidate-rule analysis; no paid AI or network access.")
    parser.add_argument("--db", type=Path, required=True, help="Private local SQLite file. Never publish it.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init", help="Create a private Log Lab database.")
    importer = commands.add_parser("import", help="Atomically import canonical UTF-8 JSON, NDJSON or CSV.")
    importer.add_argument("input", type=Path)
    importer.add_argument("--format", choices=("json", "ndjson", "jsonl", "csv"))
    commands.add_parser("analyze", help="Evaluate three deterministic rules over retained records.")
    report = commands.add_parser("report", help="Write a pseudonymized Markdown report; command lines omitted.")
    report.add_argument("--output", type=Path, required=True)
    report.add_argument("--run", help="Optional specific analysis run identifier.")
    args = parser.parse_args(argv)
    if sys.version_info < (3, 12):
        parser.error("Python 3.12 or later is required.")
    connection = None
    try:
        # Validate before creating/opening a database; a malformed file changes no data.
        dataset = read_logs(args.input, args.format) if args.command == "import" else None
        connection = connect(args.db, create=args.command in ("init", "import"))
        if args.command == "init":
            result = {"initialized": True, "sensitiveDatabase": True}
        elif args.command == "import":
            result = import_dataset(connection, dataset, args.input.name)
        elif args.command == "analyze":
            result = analyze_database(connection)
        else:
            text = markdown_report(connection, args.run)
            # Exclusive creation prevents accidental replacement of logs, databases or reports.
            args.output.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
                    stream.write(text)
            except BaseException:
                # Only remove the new file exclusively created by this invocation.
                args.output.unlink(missing_ok=True)
                raise
            result = {"reportWritten": True, "pseudonymized": True, "commandLinesIncluded": False}
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ImportError, OSError, sqlite3.Error) as error:
        # OS/SQLite exception strings can contain private filenames/fields. Keep diagnostics bounded.
        message = str(error) if isinstance(error, ImportError) else "Local file/database operation failed. Check permissions, existing output and database compatibility."
        print(f"Log Lab: {message}", file=sys.stderr)
        return 2
    finally:
        if connection is not None:
            connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
