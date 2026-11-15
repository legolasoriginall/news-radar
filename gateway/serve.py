"""درگاه محلی Respan برای دستیار مدیر خبر رادار.

این اسکریپت درگاه را فقط روی ۱۲۷.۰.۰.۱ بالا می‌آورد تا کلیدهای تأمین‌کننده
(OPENAI_API_KEY، ANTHROPIC_API_KEY، GEMINI_API_KEY و ...) از خود این کامپیوتر
بیرون نروند. پیکربندی:

- RESPAN_GATEWAY_HOST / RESPAN_GATEWAY_PORT (پیش‌فرض 127.0.0.1:8788)
- RESPAN_GATEWAY_CONFIG: مسیر gateway.toml؛ بدون آن خود درگاه gateway.toml کنار
  پروژه را می‌خواند و اگر نبود، از کلیدهای محیطی تأمین‌کننده استفاده می‌کند.
- کلیدها از همان فایل .env پروژه (خارج از گیت) خوانده می‌شوند؛ محیط موجود
  همیشه بر .env اولویت دارد. با RESPAN_GATEWAY_ENV_FILE می‌شود مسیر دیگری داد.
"""

import os
import sys
from pathlib import Path

import respan_gateway as rg

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8788
ROOT = Path(__file__).resolve().parent.parent


def load_env_file(path: Path) -> None:
    """متغیرهای .env را بدون بازنویسی محیط فعلی به محیط اضافه می‌کند."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        if name.startswith("export "):
            name = name[len("export "):].strip()
        value = value.strip().strip('"').strip("'")
        if name and value and name not in os.environ:
            os.environ[name] = value


def has_provider_key() -> bool:
    return any(name.endswith("_API_KEY") and value for name, value in os.environ.items())


def main() -> int:
    host = os.environ.get("RESPAN_GATEWAY_HOST", DEFAULT_HOST)
    raw_port = os.environ.get("RESPAN_GATEWAY_PORT", str(DEFAULT_PORT))
    try:
        port = int(raw_port)
    except ValueError:
        print(f"× RESPAN_GATEWAY_PORT عددی نیست: {raw_port}", file=sys.stderr)
        return 1

    load_env_file(Path(os.environ.get("RESPAN_GATEWAY_ENV_FILE") or ROOT / ".env"))

    config_path = os.environ.get("RESPAN_GATEWAY_CONFIG", "").strip()
    if not config_path and not has_provider_key():
        print(
            "× هیچ کلید تأمین‌کننده‌ای پیدا نشد. در .env پروژه OPENAI_API_KEY یا "
            "ANTHROPIC_API_KEY (و در صورت نیاز RESPAN_OPENAI_BASE_URL) را بگذار.",
            file=sys.stderr,
        )
        return 1

    try:
        gateway = rg.Gateway.from_file(config_path) if config_path else rg.Gateway()
    except (rg.ConfigError, OSError) as error:
        print(f"× درگاه بالا نیامد: {error}", file=sys.stderr)
        return 1

    print(f"› درگاه Respan روی http://{host}:{port}/v1 بالا آمد (خروج با Ctrl-C)")
    try:
        gateway.serve_forever(host=host, port=port)
    except KeyboardInterrupt:
        pass
    except OSError as error:
        print(f"× پورت {port} آزاد نیست: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
