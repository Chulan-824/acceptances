"""Project configuration and Docker boundary checks, without processes or network."""

import contextlib
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import launch
from chrome import chrome_endpoint, container_endpoint, validate_endpoint


class LauncherTests(unittest.TestCase):
    def config(self, directory, text):
        path = Path(directory) / "config.env"
        path.write_text(text)
        return {"JEV_CONFIG_FILE": str(path)}

    def test_project_config_injects_values_and_environment_wins(self):
        with tempfile.TemporaryDirectory() as directory:
            original = self.config(
                directory,
                "# local settings\nTYPESAFE_API_KEY='file-key'\nTYPESAFE_MODEL=jev-1.13.0\n"
                "JEV_CHROME_CDP_URL=http://localhost:9222\n",
            )
            self.assertEqual(launch.project_environment(original)["TYPESAFE_API_KEY"], "file-key")
            original["TYPESAFE_API_KEY"] = "environment-key"
            self.assertEqual(
                launch.project_environment(original)["TYPESAFE_API_KEY"], "environment-key"
            )
            original["TYPESAFE_API_KEY"] = ""
            self.assertEqual(launch.project_environment(original)["TYPESAFE_API_KEY"], "")
            self.assertNotIn("TYPESAFE_MODEL", original)

    def test_config_is_data_and_does_not_expand_shell_syntax(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.config(directory, "TYPESAFE_API_KEY='literal-$(never-execute)'\n")
            self.assertEqual(
                launch.project_environment(env)["TYPESAFE_API_KEY"], "literal-$(never-execute)"
            )

    def test_config_errors_never_include_values(self):
        with tempfile.TemporaryDirectory() as directory:
            for text in (
                "TYPESAFE_API_KEY\n",
                "TYPESAFE_API_KEY=do-not-print\nTYPESAFE_API_KEY=second",
                "TYPESAFE_API_KEY='do-not-print",
            ):
                with self.subTest(text=text):
                    with self.assertRaises(ValueError) as raised:
                        launch.project_environment(self.config(directory, text))
                    self.assertNotIn("do-not-print", str(raised.exception))

    def test_root_env_is_default_and_unrelated_variables_are_not_forwarded(self):
        self.assertEqual(launch.DEFAULT_CONFIG, launch.ROOT / ".env")
        with tempfile.TemporaryDirectory() as directory:
            env = self.config(
                directory, "UNRELATED_SECRET=ignored\nexport TYPESAFE_API_KEY=file-key\n"
            )
            loaded = launch.project_environment(env)
            self.assertEqual(loaded["TYPESAFE_API_KEY"], "file-key")
            self.assertNotIn("UNRELATED_SECRET", loaded)

    def test_explicit_missing_config_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "不存在"):
                launch.project_environment({"JEV_CONFIG_FILE": f"{directory}/missing.env"})

    def test_config_creation_is_private_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "private/config.env"
            env = {"JEV_CONFIG_FILE": str(path)}
            with contextlib.redirect_stdout(io.StringIO()):
                launch.initialize_config(env)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            path.write_text("TYPESAFE_API_KEY=existing-value\n")
            with self.assertRaisesRegex(ValueError, "未覆盖"):
                launch.initialize_config(env)
            self.assertIn("existing-value", path.read_text())

    def test_host_launcher_passes_key_only_in_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.config(directory, "TYPESAFE_API_KEY=fixture-key\n")
            with (
                patch.dict(os.environ, env, clear=True),
                patch("launch.subprocess.run") as run,
            ):
                run.return_value.returncode = 2
                self.assertEqual(launch.main(["doctor"]), 2)
            arguments, kwargs = run.call_args
            self.assertNotIn("fixture-key", " ".join(arguments[0]))
            self.assertEqual(kwargs["env"]["TYPESAFE_API_KEY"], "fixture-key")

    def test_docker_only_mounts_selected_task_and_evidence(self):
        with tempfile.TemporaryDirectory() as directory, patch("launch.sys.platform", "darwin"):
            task = Path(directory) / "task.json"
            task.write_text("{}")
            env = {
                "TYPESAFE_API_KEY": "fixture-key",
                "JEV_CHROME_CDP_URL": "ws://127.0.0.1:9222/devtools/browser/abc",
                "JEV_EVIDENCE_DIR": f"{directory}/evidence",
            }
            command, child = launch.docker_command(["run", str(task)], env)
            self.assertEqual(command[-2:], ["run", "/task.json"])
            self.assertEqual(child["JEV_TASK_FILE"], str(task.resolve()))
            self.assertEqual(
                child["JEV_CHROME_CDP_URL"], "ws://host.docker.internal:9222/devtools/browser/abc"
            )
            self.assertEqual(child["TYPESAFE_API_KEY"], "fixture-key")
            self.assertNotIn("fixture-key", " ".join(command))
            self.assertIn(os.devnull, command)
            self.assertEqual(child["JEV_BUILD_CONTEXT"], str(launch.ROOT / "tools/jev-browser"))
            self.assertNotIn("JEV_TASK_FILE", env)

    def test_docker_linux_uses_host_network_without_rewriting_loopback(self):
        with tempfile.TemporaryDirectory() as directory, patch("launch.sys.platform", "linux"):
            command, child = launch.docker_command(
                ["inspect", "http://127.0.0.1:5173/"],
                {
                    "JEV_CHROME_CDP_URL": "http://127.0.0.1:9222",
                    "JEV_EVIDENCE_DIR": directory,
                },
            )
            self.assertIn(str(launch.ROOT / "deploy/compose.jev-linux.yaml"), command)
            self.assertEqual(child["JEV_CHROME_CDP_URL"], "http://127.0.0.1:9222")

    def test_docker_rejects_missing_key_and_env_task(self):
        with self.assertRaisesRegex(ValueError, "TYPESAFE_API_KEY"):
            launch.docker_command(["run", "unused.json"], {})
        with tempfile.TemporaryDirectory() as directory:
            task = Path(directory) / ".env.task"
            task.touch()
            with self.assertRaisesRegex(ValueError, "TASK"):
                launch.docker_command(
                    ["run", str(task)],
                    {
                        "TYPESAFE_API_KEY": "fixture-key",
                        "JEV_CHROME_CDP_URL": "http://localhost:9222",
                        "JEV_EVIDENCE_DIR": directory,
                    },
                )

    def test_explicit_cdp_endpoint_works_on_linux_without_profile_files(self):
        with (
            patch("chrome.sys.platform", "linux"),
            patch.object(Path, "read_text", side_effect=AssertionError("must not discover")),
        ):
            self.assertEqual(
                chrome_endpoint({"JEV_CHROME_CDP_URL": "http://localhost:9222"}),
                "http://localhost:9222",
            )
        for invalid in (
            "https://name:password@example.com",
            "file:///tmp/chrome",
            "ws://localhost:9222/other",
            "http://localhost:9222?key=hidden",
            "http://localhost:99999",
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_endpoint(invalid)
        with patch("chrome.sys.platform", "darwin"):
            self.assertEqual(
                container_endpoint("http://[::1]:9222"), "http://host.docker.internal:9222"
            )

    def test_docker_gateway_is_resolved_only_inside_executor_for_chrome_host_header(self):
        env = {"JEV_CHROME_CDP_URL": "ws://host.docker.internal:9222/devtools/browser/abc"}
        with patch("chrome.socket.gethostbyname", return_value="192.0.2.1") as resolve:
            self.assertEqual(chrome_endpoint(env), env["JEV_CHROME_CDP_URL"])
            resolve.assert_not_called()
            self.assertEqual(
                chrome_endpoint(env, resolve_docker_host=True),
                "ws://192.0.2.1:9222/devtools/browser/abc",
            )

    def test_evidence_mount_cannot_expose_repository_or_private_config(self):
        for path in (launch.ROOT, launch.ROOT.parent):
            with self.subTest(path=path), self.assertRaises(ValueError):
                launch.evidence_directory({"JEV_EVIDENCE_DIR": str(path)})
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                launch.evidence_directory(
                    {"JEV_EVIDENCE_DIR": directory, "JEV_CONFIG_FILE": f"{directory}/private.env"}
                )


if __name__ == "__main__":
    unittest.main()
