"""Detect a legacy ``hermes-town`` plugin before Hermes Town Brent runs.

Hermes Town Brent (plugin id ``hermes-town-brent``) is a distinct plugin from
the older ``hermes-town`` catalog entry, but both register the same ``hermes
town`` CLI command and the same ten lifecycle hooks, and both share the
``$HERMES_HOME/hermes-town/`` runtime state. Running them together would
shadow one command with the other and deliver every event twice.

This module only *looks*: it checks whether ``$HERMES_HOME/plugins/hermes-town``
exists and whether ``plugins.enabled`` in ``$HERMES_HOME/config.yaml`` lists
``hermes-town``. It never edits configuration, never moves or deletes state and
never reads anything else from the config file. Standard library only.
"""

from __future__ import annotations

import os
import re
from typing import Dict, List

LEGACY_PLUGIN = "hermes-town"
CURRENT_PLUGIN = "hermes-town-brent"

_MAX_CONFIG_BYTES = 1024 * 1024


def hermes_home() -> str:
    # Hermes binds the loading profile's home to a context-local override while a plugin
    # registers, which can differ from the process environment in a multi-profile process.
    # `get_hermes_home` is the documented accessor and honours that override.
    try:
        from hermes_constants import get_hermes_home  # type: ignore[import-not-found]
        return str(get_hermes_home())
    except Exception:
        return os.environ.get("HERMES_HOME") or os.path.join(os.path.expanduser("~"), ".hermes")


def _unquote(item: str) -> str:
    item = item.split(" #", 1)[0].strip()
    if len(item) >= 2 and item[0] == item[-1] and item[0] in "'\"":
        item = item[1:-1]
    return item.strip()


def enabled_plugins(config_text: str) -> List[str]:
    """Return ``plugins.enabled`` from YAML text with a deliberately small scanner.

    Supports the block-list and inline-list forms Hermes writes. Anything it does
    not understand yields an empty list, never an exception.
    """
    names: List[str] = []
    in_plugins = False
    in_enabled = False
    enabled_indent = 0
    for raw in config_text.splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if indent == 0:
            in_plugins = bool(re.match(r"^plugins:\s*(#.*)?$", raw))
            in_enabled = False
            continue
        if not in_plugins:
            continue
        key = re.match(r"^enabled:\s*(.*)$", stripped)
        if key and not in_enabled:
            rest = key.group(1).split(" #", 1)[0].strip()
            if rest.startswith("[") and rest.endswith("]"):
                names.extend(_unquote(part) for part in rest[1:-1].split(",") if part.strip())
                in_enabled = False
            elif rest == "":
                in_enabled = True
                enabled_indent = indent
            continue
        if in_enabled:
            if indent < enabled_indent or (indent == enabled_indent and not stripped.startswith("- ")):
                in_enabled = False
                continue
            if stripped.startswith("- "):
                names.append(_unquote(stripped[2:]))
    return [name for name in names if name]


def legacy_state(home: str | None = None) -> Dict[str, bool]:
    """``{"installed": bool, "enabled": bool}`` for the legacy plugin in *home*."""
    home = home or hermes_home()
    installed = os.path.lexists(os.path.join(home, "plugins", LEGACY_PLUGIN))
    enabled = False
    config = os.path.join(home, "config.yaml")
    try:
        if os.path.isfile(config) and os.path.getsize(config) <= _MAX_CONFIG_BYTES:
            with open(config, "r", encoding="utf-8", errors="replace") as stream:
                enabled = LEGACY_PLUGIN in enabled_plugins(stream.read())
    except OSError:
        enabled = False
    return {"installed": installed, "enabled": enabled}


def conflict_message(home: str | None = None) -> str:
    home = home or hermes_home()
    return (
        f"Legacy plugin '{LEGACY_PLUGIN}' is enabled in {home}. {CURRENT_PLUGIN} will not run beside it "
        "(both own the `hermes town` command and the same lifecycle hooks), and it never overwrites or "
        "replaces the legacy plugin. To switch: run `hermes town stop` while the legacy plugin is still "
        f"enabled, then `hermes plugins disable {LEGACY_PLUGIN}` (or `hermes plugins remove {LEGACY_PLUGIN}`), "
        f"then `hermes plugins enable {CURRENT_PLUGIN}` and start a new Hermes session. Existing state under "
        f"{os.path.join(home, 'hermes-town')} is kept and shared; nothing is migrated or deleted automatically."
    )


def legacy_enabled(home: str | None = None) -> bool:
    return legacy_state(home)["enabled"]
