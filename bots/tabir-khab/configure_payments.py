"""Install private payment configuration without replacing bot tokens."""
import json
import os
from pathlib import Path
import re
import sys


def install(data: dict, destination: Path) -> None:
    keys = ("CARD_NUMBER", "CARD_OWNER", "CARD_RECIPIENT_NAME", "CARD_DEST_LAST4")
    if not isinstance(data, dict) or any(
        not isinstance(data.get(key), str) or not data[key].strip()
        or "\n" in data[key] or "\r" in data[key] for key in keys
    ):
        raise ValueError("payment configuration contains missing or invalid fields")
    if not re.fullmatch(r"\d{16}", data["CARD_NUMBER"]):
        raise ValueError("payment destination must contain sixteen digits")
    if data["CARD_DEST_LAST4"] != data["CARD_NUMBER"][-4:]:
        raise ValueError("payment destination and last four digits do not match")
    # An existing file is required so a missing bot configuration cannot go unnoticed.
    previous = destination.read_text()
    lines = [line for line in previous.splitlines() if line.split("=", 1)[0] not in keys]
    lines.extend(key + "=" + data[key] for key in keys)
    os.umask(0o077)
    temporary = destination.with_name(destination.name + ".payment-new")
    try:
        temporary.write_text("\n".join(lines) + "\n")
        temporary.chmod(0o600)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        install(json.load(sys.stdin), Path(__file__).parent / ".env")
        print(json.dumps({"event": "payment_configuration_installed", "values_logged": False}))
    except Exception as error:
        # JSON decoder details can contain private input. Only the error type is logged.
        print(json.dumps({"event": "payment_configuration_failed", "error_type": type(error).__name__}), file=sys.stderr)
        sys.exit(1)
