"""Load services/forge/.env into os.environ (only keys not already set). Never prints values."""
import os
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[2] / "services" / "forge" / ".env"


def load() -> None:
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip().removeprefix("export ").strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v
