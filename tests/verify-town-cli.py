#!/usr/bin/env python3
"""Stdlib CLI verification; all writes and servers use temporary homes."""
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import socket
import stat
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "integrations/hermes-town-plugin"
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("town_test_plugin", PLUGIN / "__init__.py", submodule_search_locations=[str(PLUGIN)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)
cli_spec = importlib.util.spec_from_file_location("town_cli", PLUGIN / "town_cli.py")
cli = importlib.util.module_from_spec(cli_spec)
cli_spec.loader.exec_module(cli)


class TownCLI(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="town-cli-test-")
        self.home = Path(self.temp.name)
        env = {k: v for k, v in os.environ.items() if not k.startswith("HERMES_TOWN_")}
        env["HERMES_HOME"] = str(self.home)
        self.env = patch.dict(os.environ, env, clear=True)
        self.env.start()
        self.runtime = self.home / "hermes-town/runtime"

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def call(self, *argv):
        parser = argparse.ArgumentParser()
        cli.setup_parser(parser)
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.run(parser.parse_args(argv))
        return code, out.getvalue(), err.getvalue()

    def test_registration(self):
        class Old:
            def __init__(self): self.hooks = []
            def register_hook(self, *args): self.hooks.append(args)
        old = Old()
        plugin.register(old)
        self.assertEqual(len(old.hooks), 10)
        class Native(Old):
            def register_cli_command(self, **kwargs): self.command = kwargs
        native = Native()
        plugin.register(native)
        self.assertEqual(native.command["name"], "town")
        parser = argparse.ArgumentParser()
        native.command["setup_fn"](parser)
        self.assertEqual(parser.parse_args(["status", "--json"]).town_action, "status")
        self.assertFalse(self.runtime.exists())

    def test_missing_bundle_and_node(self):
        with patch.object(cli, "BUNDLE", self.home / "absent"):
            self.assertEqual(self.call("setup")[0], 3)
        with patch.object(cli, "bundle_ready", return_value=True), patch.object(cli.shutil, "which", return_value=None):
            self.assertEqual(self.call("setup")[0], 3)
        self.assertFalse((self.runtime / "bridge-token").exists())

    def test_bundle_integrity(self):
        import hashlib
        bundle = self.home / "bundle"
        files = {}
        for name in ("server/serve-live.mjs", "server/townServer.mjs", "dist/index.html"):
            path = bundle / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"integrity fixture")
            files[name] = hashlib.sha256(b"integrity fixture").hexdigest()
        (bundle / "manifest.json").write_text(json.dumps({"version": "test", "files": files}))
        with patch.object(cli, "BUNDLE", bundle):
            self.assertTrue(cli.bundle_ready())
            (bundle / "dist/index.html").write_bytes(b"changed")
            self.assertFalse(cli.bundle_ready())

    def test_node_versions(self):
        for version, expected in [("v20.18.9", False), ("v20.19.0", True), ("v21.9.0", False), ("v22.11.9", False), ("v22.12.0", True), ("v24.0.0", True)]:
            with patch.object(cli.shutil, "which", return_value="/node"), patch.object(cli.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, version)):
                self.assertEqual(bool(cli.node_status()[0]), expected, version)

    def test_idempotent_token_and_bad_token(self):
        with patch.object(cli, "bundle_ready", return_value=True), patch.object(cli, "node_status", return_value=("/node", "ready")):
            self.assertEqual(self.call("setup")[0], 0)
            token_path = self.runtime / "bridge-token"
            token = token_path.read_text()
            result = self.call("setup")
            self.assertEqual(result[0], 0)
            self.assertEqual(token_path.read_text(), token)
            if os.name == "posix":
                self.assertEqual(token_path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn(token.strip(), result[1] + result[2])
            token_path.write_text("weak")
            self.assertEqual(self.call("setup")[0], 2)
            self.assertEqual(token_path.read_text(), "weak")

    @unittest.skipUnless(os.name == "posix", "POSIX modes and unprivileged symlinks")
    def test_symlinks_and_permissions_refused(self):
        cli.runtime_dirs(self.runtime, create=True)
        target = self.home / "outside"
        target.write_text("do not touch")
        (self.runtime / "bridge-token").symlink_to(target)
        with patch.object(cli, "bundle_ready", return_value=True), patch.object(cli, "node_status", return_value=("/node", "ready")):
            self.assertEqual(self.call("setup")[0], 2)
        self.assertEqual(target.read_text(), "do not touch")
        (self.runtime / "bridge-token").unlink()
        (self.runtime / "bridge-token").write_text(secrets.token_hex(32))
        (self.runtime / "bridge-token").chmod(0o644)
        with self.assertRaises(cli.TownError): cli.token_ready(self.runtime)

    def test_conflicting_environment(self):
        self.assertEqual(self.call("start", "--port", "4999")[0], 2)
        for url in ("https://127.0.0.1:4999/api/town/ingest", "http://example.com:4999/api/town/ingest", "http://127.0.0.1:4999/wrong", "http://u:p@127.0.0.1:4999/api/town/ingest"):
            with patch.dict(os.environ, {"HERMES_TOWN_BRIDGE_URL": url}):
                self.assertEqual(self.call("start")[0], 2)
        with patch.dict(os.environ, {"HERMES_TOWN_BRIDGE_TOKEN_FILE": str(self.home / "elsewhere")}):
            self.assertEqual(self.call("setup")[0], 2)

    def test_plain_status_is_actionable(self):
        with patch.object(cli, "listening", return_value=False), patch.object(cli, "api", return_value=None):
            result = self.call("status")
        self.assertEqual(result[0], 0)
        self.assertIn("Local setup:", result[1])
        self.assertIn("Server:", result[1])
        self.assertIn("Hermes events:", result[1])
        self.assertIn("hermes town start", result[1])
        self.assertNotIn("managedByThisProfile", result[1])

    def test_status_unknown_and_no_write(self):
        result = self.call("status", "--json")
        self.assertEqual(result[0], 0)
        data = json.loads(result[1])
        self.assertEqual(data["pluginLoadedInObservedProcess"], "unknown")
        self.assertIsNone(data["firstEventsObserved"])
        self.assertFalse(self.runtime.exists())

    def test_lock_conflict(self):
        with cli.locked(self.runtime):
            self.assertEqual(self.call("setup")[0], 6)

    @unittest.skipUnless(os.name == "posix", "POSIX migration and symlinks")
    def test_legacy_directory_migration_is_explicit(self):
        self.runtime.parent.mkdir(mode=0o755)
        self.runtime.parent.chmod(0o755)
        self.assertEqual(self.call("status", "--json")[0], 2)
        self.assertEqual(stat.S_IMODE(self.runtime.parent.stat().st_mode), 0o755)
        with patch.object(cli, "bundle_ready", return_value=True), patch.object(cli, "node_status", return_value=("/node", "ready")):
            self.assertEqual(self.call("setup")[0], 0)
        self.assertEqual(stat.S_IMODE(self.runtime.parent.stat().st_mode), 0o700)
        target = self.home / "outside-dir"
        target.mkdir(mode=0o755)
        linked = self.home / "linked"
        linked.symlink_to(target, target_is_directory=True)
        with self.assertRaises(cli.TownError):
            cli.runtime_dirs(linked / "runtime", create=True, tighten=True)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o755)

    def test_windows_file_and_spawn_helpers_mocked(self):
        # Branch tests only: not evidence of execution on a Windows host.
        windows = Mock(wraps=os)
        windows.name = "nt"
        windows.O_BINARY = 0x8000
        windows.getuid = Mock(side_effect=AssertionError("Windows has no getuid"))
        info = SimpleNamespace(st_mode=stat.S_IFREG | 0o666, st_nlink=1)
        with patch.object(cli, "os", windows):
            self.assertTrue(cli.safe_info(info))
            for field, value in (("st_nlink", 2), ("st_mode", stat.S_IFLNK | 0o777), ("st_file_attributes", 0x400)):
                bad = SimpleNamespace(**vars(info))
                setattr(bad, field, value)
                self.assertFalse(cli.safe_info(bad))
            self.assertTrue(cli.safe_info(SimpleNamespace(st_mode=stat.S_IFDIR | 0o777), directory=True))
            self.assertEqual(cli.private_flags(os.O_RDONLY), os.O_RDONLY | 0x8000)
            with patch.object(cli.subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200, create=True), patch.object(cli.subprocess, "DETACHED_PROCESS", 8, create=True):
                self.assertEqual(cli.spawn_options(), {"creationflags": 0x208, "close_fds": True})
            windows.getuid.assert_not_called()

    def test_windows_lock_helpers_mocked(self):
        windows = Mock(wraps=os)
        windows.name = "nt"
        windows.SEEK_SET = os.SEEK_SET
        windows.fstat = Mock(return_value=SimpleNamespace(st_size=0))
        windows.write = Mock()
        windows.lseek = Mock()
        msvcrt = SimpleNamespace(LK_NBLCK=2, LK_UNLCK=0, locking=Mock())
        with patch.object(cli, "os", windows), patch.dict(sys.modules, {"msvcrt": msvcrt}):
            cli.file_lock(123)
            windows.write.assert_called_once_with(123, b"\0")
            msvcrt.locking.assert_called_with(123, 2, 1)
            cli.file_lock(123, unlock=True)
            windows.lseek.assert_called_with(123, 0, os.SEEK_SET)
            msvcrt.locking.assert_called_with(123, 0, 1)
            msvcrt.locking.side_effect = OSError("locked")
            with self.assertRaises(OSError):
                cli.file_lock(123)

    @unittest.skipUnless(os.name == "posix", "real POSIX descriptor security")
    def test_private_open_rejects_hardlinks_and_replacement(self):
        cli.runtime_dirs(self.runtime, create=True)
        path = self.runtime / "fixture"
        fd = cli.private_open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.close(fd)
        linked = self.runtime / "hardlink"
        os.link(path, linked)
        with self.assertRaises(cli.TownError):
            cli.private_open(path, os.O_RDONLY)
        linked.unlink()
        with patch.object(cli.os.path, "samestat", return_value=False):
            with self.assertRaises(cli.TownError):
                cli.private_open(path, os.O_RDONLY)
        self.assertEqual(cli.spawn_options(), {"start_new_session": True, "umask": 0o077, "close_fds": True})

    def test_stop_requires_202_acknowledgement(self):
        connection = Mock()
        response = connection.getresponse.return_value
        response.read.return_value = b'{"ok":true}'
        with patch.object(cli.http.client, "HTTPConnection", return_value=connection):
            response.status = 202
            self.assertEqual(cli.api(4187, "manage/stop", "test", "POST"), {"ok": True})
            self.assertIsNone(cli.api(4187, "health"))
            response.status = 200
            self.assertIsNone(cli.api(4187, "manage/stop", "test", "POST"))
        with patch.object(cli, "owned", return_value=True), patch.object(cli, "api", return_value=None), patch.object(cli, "listening") as listening:
            with self.assertRaises(cli.TownError) as error:
                cli.stop_owned({"port": 4187, "managementToken": "test"})
            self.assertEqual(error.exception.code, 5)
            listening.assert_not_called()

    def test_bounded_log(self):
        cli.runtime_dirs(self.runtime, create=True)
        result = subprocess.run([sys.executable, str(PLUGIN / "town_cli.py"), "--_log-sink", str(self.runtime)], input=b"test log\n" * 400000, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in ("server.log", "server.log.1"):
            path = self.runtime / name
            self.assertLessEqual(path.stat().st_size, cli.LOG_LIMIT)
            if os.name == "posix":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    @unittest.skipUnless(cli.bundle_ready() and cli.node_status()[0], "packaged runtime and supported Node required")
    def test_packaged_lifecycle(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        os.environ["HERMES_TOWN_BRIDGE_URL"] = f"http://127.0.0.1:{port}/api/town/ingest"
        try:
            result = self.call("start")
            self.assertEqual(result[0], 0, result)
            state = cli.read_state(self.runtime)
            self.assertTrue(cli.owned(state))
            self.assertEqual(self.call("start")[0], 0)
            self.assertEqual(cli.read_state(self.runtime)["managementToken"], state["managementToken"])
            report = json.loads(self.call("status", "--json")[1])
            self.assertTrue(report["managedByThisProfile"])
            self.assertFalse(report["firstEventsObserved"])
            with patch.dict(os.environ, {"HERMES_HOME": str(self.home / "other")}):
                (self.home / "other").mkdir()
                self.assertEqual(self.call("start")[0], 4)
                self.assertEqual(self.call("stop")[0], 4)
            self.assertTrue(cli.owned(state))
            # Explicitly synthetic transport fixture, not a real Hermes event.
            import http.client
            connection = http.client.HTTPConnection("127.0.0.1", port)
            payload = {"v": plugin.INGRESS_VERSION, "events": [{"id": "synthetic_cli_fixture", "key": "h/main/0123456789abcdef", "kind": "spawned", "role": "coordinator"}]}
            connection.request("POST", "/api/town/ingest", json.dumps(payload), {"Content-Type": "application/json", "Authorization": "Bearer " + (self.runtime / "bridge-token").read_text().strip()})
            response = connection.getresponse()
            self.assertEqual(response.status, 202, response.read())
            connection.close()
            self.assertTrue(json.loads(self.call("status", "--json")[1])["firstEventsObserved"])
            self.assertEqual(self.call("stop")[0], 0)
            self.assertFalse(cli.listening(port))
            self.assertEqual(self.call("stop")[0], 0)
            self.assertNotIn(state["managementToken"], (self.runtime / "server.log").read_text())
            # Stale identity cannot authorize a listener or cause PID signalling.
            cli.save_state(self.runtime, {**state, "pid": os.getpid()})
            with socket.socket() as unrelated:
                # The just-stopped server leaves its closed connections in TIME_WAIT on this port;
                # a real server sets SO_REUSEADDR, and without it this bind raced (EADDRINUSE).
                # SO_REUSEADDR still refuses a port that has a live listener.
                unrelated.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                unrelated.bind(("127.0.0.1", port))
                unrelated.listen()
                self.assertEqual(self.call("stop")[0], 4)
                self.assertEqual(self.call("start")[0], 4)
        finally:
            state = cli.read_state(self.runtime) if self.runtime.exists() else None
            if cli.owned(state): cli.stop_owned(state)


class TownCLIShared(unittest.TestCase):
    """The one shared town: one server, one private token per local profile."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="town-shared-cli-test-")
        self.root = Path(self.temp.name)
        self.coder = self.root / "profiles" / "coder"
        self.coder.mkdir(parents=True)
        (self.root / "profiles" / "uat").mkdir()
        (self.root / "profiles" / "Not_A_Label").mkdir()
        env = {k: v for k, v in os.environ.items() if not k.startswith("HERMES_TOWN_")}
        env["HERMES_HOME"] = str(self.coder)  # a named profile: the shared root is two levels up
        self.env = patch.dict(os.environ, env, clear=True)
        self.env.start()
        self.runtime = self.root / "hermes-town-shared" / "runtime"

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    call = TownCLI.call

    def registered(self):
        return [entry["name"] for entry in cli.read_registry(self.runtime)]

    def token(self, name):
        home = self.root if name == "default" else self.root / "profiles" / name
        return (home / "hermes-town/runtime/bridge-token")

    def test_root_is_found_from_a_named_profile_and_from_default(self):
        self.assertEqual(cli.settings(None, True)[0], self.root)
        self.assertEqual(cli.settings(None, True)[1], self.runtime)
        with patch.dict(os.environ, {"HERMES_HOME": str(self.root)}):
            self.assertEqual(cli.settings(None, True)[0], self.root)
        # The profile-local runtime is untouched by the shared option.
        self.assertEqual(cli.settings(None, False)[1], self.coder / "hermes-town/runtime")

    def test_sync_registers_every_profile_with_its_own_private_token(self):
        result = self.call("profiles", "sync")
        self.assertEqual(result[0], 0, result)
        self.assertEqual(self.registered(), ["default", "coder", "uat"])  # invalid label skipped
        tokens = {name: self.token(name).read_text().strip() for name in self.registered()}
        self.assertEqual(len(set(tokens.values())), 3, "each profile has a distinct token")
        for name, value in tokens.items():
            self.assertNotIn(value, result[1] + result[2])
            if os.name == "posix":
                self.assertEqual(self.token(name).stat().st_mode & 0o777, 0o600)
        if os.name == "posix":
            self.assertEqual((self.runtime / "profiles.json").stat().st_mode & 0o777, 0o600)
        # Idempotent: nothing new, and no token is rewritten.
        again = self.call("profiles", "sync")
        self.assertEqual(again[0], 0)
        self.assertIn("nothing new", again[1])
        self.assertEqual({name: self.token(name).read_text().strip() for name in self.registered()}, tokens)
        registry = json.loads((self.runtime / "profiles.json").read_text())
        self.assertEqual(registry["v"], "hermes-town.profiles.v1")
        self.assertTrue(all(set(entry) == {"name", "home"} for entry in registry["profiles"]))

    @unittest.skipUnless(os.name == "posix", "symlinks")
    def test_symlinked_profile_directories_are_not_followed(self):
        outside = self.root / "outside"
        outside.mkdir()
        (self.root / "profiles" / "linked").symlink_to(outside, target_is_directory=True)
        self.assertEqual(self.call("profiles", "sync")[0], 0)
        self.assertNotIn("linked", self.registered())
        self.assertFalse((outside / "hermes-town").exists())

    def test_add_list_remove(self):
        self.assertEqual(self.call("profiles", "list")[0], 0)
        self.assertEqual(self.call("profiles", "add", "uat")[0], 0)
        self.assertEqual(self.registered(), ["uat"])
        self.assertTrue(self.token("uat").exists())
        self.assertFalse(self.token("coder").exists(), "adding one profile touches only that profile")
        self.assertIn("already registered", self.call("profiles", "add", "uat")[1])
        listed = self.call("profiles", "list")
        self.assertIn("uat: token ready", listed[1])
        self.assertEqual(self.call("profiles", "add", "ghost")[0], 2)
        self.assertEqual(self.call("profiles", "add", "Bad Name", "--home", str(self.root))[0], 2)
        self.assertEqual(self.call("profiles", "add", "elsewhere", "--home", "relative/path")[0], 2)
        elsewhere = self.root / "elsewhere-home"
        elsewhere.mkdir()
        self.assertEqual(self.call("profiles", "add", "elsewhere", "--home", str(elsewhere))[0], 0)
        self.assertEqual(self.call("profiles", "add", "elsewhere", "--home", str(self.coder))[0], 2, "a name cannot be rebound to another home")
        token = self.token("uat").read_text()
        self.assertEqual(self.call("profiles", "remove", "uat")[0], 0)
        self.assertEqual(self.registered(), ["elsewhere"])
        self.assertEqual(self.token("uat").read_text(), token, "removing a profile leaves its token file alone")
        self.assertEqual(self.call("profiles", "remove", "uat")[0], 2)

    def test_invalid_registry_is_refused(self):
        cli.runtime_dirs(self.runtime, create=True)
        target = self.runtime / "profiles.json"
        for bad in ('{"v":"x","profiles":[]}', '{"v":"hermes-town.profiles.v1","profiles":[{"name":"a","home":"rel"}]}',
                    '{"v":"hermes-town.profiles.v1","profiles":[{"name":"a","home":"/x","tokenFile":"/etc/passwd"}]}', "not json"):
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as stream:
                stream.write(bad)
            self.assertEqual(self.call("profiles", "list")[0], 2, bad)

    def test_shared_start_needs_profiles_and_ignores_token_override(self):
        with patch.object(cli, "bundle_ready", return_value=True), patch.object(cli, "node_status", return_value=("/node", "ready")):
            self.assertEqual(self.call("start", "--shared")[0], 3)
            self.assertFalse((self.runtime / "bridge-token").exists(), "the shared town has no token of its own")
        with patch.dict(os.environ, {"HERMES_TOWN_BRIDGE_TOKEN_FILE": str(self.root / "elsewhere")}):
            with patch.object(cli, "bundle_ready", return_value=True), patch.object(cli, "node_status", return_value=("/node", "ready")):
                self.assertEqual(self.call("setup", "--shared")[0], 0)

    def test_shared_setup_registers_all_and_reports_without_secrets(self):
        with patch.object(cli, "bundle_ready", return_value=True), patch.object(cli, "node_status", return_value=("/node", "ready")):
            result = self.call("setup", "--shared")
        self.assertEqual(result[0], 0, result)
        self.assertEqual(self.registered(), ["default", "coder", "uat"])
        for name in self.registered():
            self.assertNotIn(self.token(name).read_text().strip(), result[1] + result[2])
        with patch.object(cli, "listening", return_value=False), patch.object(cli, "api", return_value=None):
            status = self.call("status", "--shared")
            data = json.loads(self.call("status", "--shared", "--json")[1])
        self.assertIn("Shared Town:", status[1])
        self.assertIn("coder: token ready", status[1])
        self.assertIn("hermes town start --shared", status[1])
        self.assertEqual([p["name"] for p in data["profiles"]], ["default", "coder", "uat"])
        self.assertTrue(all(p["tokenReady"] for p in data["profiles"]))
        self.assertTrue(data["shared"])

    @unittest.skipUnless(cli.bundle_ready() and cli.node_status()[0], "packaged runtime and supported Node required")
    def test_packaged_shared_lifecycle(self):
        import http.client
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        os.environ["HERMES_TOWN_BRIDGE_URL"] = f"http://127.0.0.1:{port}/api/town/ingest"
        try:
            self.assertEqual(self.call("setup", "--shared")[0], 0)
            result = self.call("start", "--shared")
            self.assertEqual(result[0], 0, result)
            state = cli.read_state(self.runtime)
            self.assertTrue(cli.owned(state))
            self.assertEqual(self.call("start", "--shared")[0], 0, "start is idempotent")
            # A profile-local start must not adopt or fight the shared listener.
            self.assertEqual(self.call("start")[0], 4)

            def post(name, key):
                connection = http.client.HTTPConnection("127.0.0.1", port)
                payload = {"v": plugin.INGRESS_VERSION, "events": [{"id": f"synthetic_{name}_fixture", "key": key, "kind": "spawned", "role": "coordinator"}]}
                connection.request("POST", "/api/town/ingest", json.dumps(payload), {"Content-Type": "application/json", "Authorization": "Bearer " + self.token(name).read_text().strip()})
                response = connection.getresponse()
                body = response.read()
                connection.close()
                return response.status, body

            self.assertEqual(post("coder", "h/main/0123456789abcdef")[0], 202)
            self.assertEqual(post("uat", "h/main/fedcba9876543210")[0], 202)
            report = json.loads(self.call("status", "--shared", "--json")[1])
            by_name = {p["name"]: p for p in report["profiles"]}
            self.assertTrue(report["managedByThisHost"])
            self.assertEqual(by_name["coder"]["receivedEvents"], 1)
            self.assertEqual(by_name["uat"]["receivedEvents"], 1)
            self.assertEqual(by_name["default"]["receivedEvents"], 0)
            self.assertTrue(all(p["loadedByServer"] for p in report["profiles"]))
            connection = http.client.HTTPConnection("127.0.0.1", port)
            connection.request("GET", "/api/town/snapshot")
            snapshot = json.loads(connection.getresponse().read())
            connection.close()
            labels = {e["agentId"]: e.get("profile") for e in snapshot["events"] if e["type"] == "agent.spawned"}
            self.assertEqual(labels, {"h/main/0123456789abcdef": "coder", "h/main/fedcba9876543210": "uat"})
            self.assertEqual(self.call("stop", "--shared")[0], 0)
            self.assertFalse(cli.listening(port))
            self.assertNotIn(state["managementToken"], (self.runtime / "server.log").read_text())
        finally:
            state = cli.read_state(self.runtime) if self.runtime.exists() else None
            if cli.owned(state): cli.stop_owned(state)


class LegacyPluginGuard(unittest.TestCase):
    """The renamed plugin never runs beside, or over, an enabled legacy `hermes-town` plugin."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="town-legacy-test-")
        self.home = Path(self.temp.name)
        env = {k: v for k, v in os.environ.items() if not k.startswith("HERMES_TOWN_")}
        env["HERMES_HOME"] = str(self.home)
        self.env = patch.dict(os.environ, env, clear=True)
        self.env.start()
        spec_g = importlib.util.spec_from_file_location("town_legacy_guard", PLUGIN / "legacy_guard.py")
        self.guard = importlib.util.module_from_spec(spec_g)
        spec_g.loader.exec_module(self.guard)

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def config(self, text):
        (self.home / "config.yaml").write_text(text)

    def register(self):
        class Ctx:
            def __init__(self): self.hooks, self.commands = [], []
            def register_hook(self, *args): self.hooks.append(args)
            def register_cli_command(self, **kwargs): self.commands.append(kwargs)
        ctx = Ctx()
        plugin.register(ctx)
        return ctx

    def test_manifest_identity(self):
        manifest = (PLUGIN / "plugin.yaml").read_text()
        self.assertIn("name: hermes-town-brent\n", manifest)
        self.assertNotIn("sxuff", manifest)
        self.assertIn("https://github.com/brent-at-realty/hermes-town", manifest)

    def test_enabled_list_parsing(self):
        parse = self.guard.enabled_plugins
        self.assertEqual(parse("plugins:\n  enabled:\n    - a\n    - 'hermes-town'  # x\n  disabled: []\nother:\n  enabled:\n    - nope\n"), ["a", "hermes-town"])
        self.assertEqual(parse("plugins:\n  enabled: [a, \"hermes-town\"]\n"), ["a", "hermes-town"])
        self.assertEqual(parse("plugins:\n  enabled:\n  - hermes-town-brent\n"), ["hermes-town-brent"])
        self.assertEqual(parse("plugins:\n  disabled:\n    - hermes-town\n  enabled: []\n"), [])
        self.assertEqual(parse("not: yaml: at all\n\x00"), [])

    def test_no_legacy_registers_normally(self):
        self.assertEqual(self.guard.legacy_state(str(self.home)), {"installed": False, "enabled": False})
        ctx = self.register()
        self.assertEqual(len(ctx.hooks), 10)
        self.assertEqual(ctx.commands[0]["name"], "town")

    def test_installed_but_disabled_legacy_does_not_block(self):
        (self.home / "plugins/hermes-town").mkdir(parents=True)
        self.config("plugins:\n  enabled:\n    - hermes-town-brent\n  disabled:\n    - hermes-town\n")
        self.assertEqual(self.guard.legacy_state(str(self.home)), {"installed": True, "enabled": False})
        ctx = self.register()
        self.assertEqual(len(ctx.hooks), 10)

    def test_enabled_legacy_leaves_plugin_inert_and_changes_nothing(self):
        legacy = self.home / "plugins/hermes-town"
        legacy.mkdir(parents=True)
        (legacy / "marker").write_text("legacy bytes")
        text = "plugins:\n  enabled:\n    - hermes-town\n    - hermes-town-brent\n"
        self.config(text)
        with self.assertLogs(plugin.logger, level="WARNING") as logs:
            ctx = self.register()
        self.assertEqual((ctx.hooks, ctx.commands), ([], []))
        message = "\n".join(logs.output)
        self.assertIn("hermes plugins disable hermes-town", message)
        self.assertIn("hermes town stop", message)
        self.assertIn("nothing is migrated or deleted", message)
        self.assertEqual((self.home / "config.yaml").read_text(), text)
        self.assertEqual((legacy / "marker").read_text(), "legacy bytes")
        self.assertFalse((self.home / "hermes-town").exists())

    def test_guard_failure_never_breaks_loading(self):
        with patch.dict(sys.modules, {plugin.__name__ + ".legacy_guard": None}):
            ctx = self.register()
        self.assertEqual(len(ctx.hooks), 10)


if __name__ == "__main__":
    unittest.main(verbosity=2)
