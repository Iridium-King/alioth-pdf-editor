import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import _native_host as native
from _browser_migration import BrowserMigration, MigrationSession
import _proxy as proxy


class StopMonitor(Exception):
    pass


class NativeHostTests(unittest.TestCase):
    def setUp(self):
        tracking = patch.object(native, '_processes', set())
        tracking.start()
        self.addCleanup(tracking.stop)
        cleanup = patch.object(proxy, 'reap_inactive_hosts', return_value=0)
        cleanup.start()
        self.addCleanup(cleanup.stop)

    def test_ready_is_scoped_to_the_launched_process_token(self):
        process = Mock()
        process.poll.return_value = None
        def launch(arguments, **kwargs):
            self.assertFalse(native.notify_ready('unrelated-token'))
            self.assertTrue(native.notify_ready(arguments[-1]))
            self.assertEqual(arguments[1], 'http://127.0.0.1:8877/BASE.html')
            return process
        with patch.object(native.subprocess, 'Popen', side_effect=launch):
            self.assertTrue(native.launch_native_host('http://127.0.0.1:8877/BASE.html', ROOT, profile=ROOT / '_qa_unused'))
        self.assertFalse(native._sessions)
        process.terminate.assert_not_called()
        self.assertEqual(native.active_host_count(), 1)
        process.poll.return_value = 0
        self.assertEqual(native.active_host_count(), 0)

    def test_missing_host_keeps_the_existing_browser_fallback(self):
        with patch.object(native, 'host_executable', return_value=None), patch.object(native.subprocess, 'Popen') as launch:
            self.assertFalse(native.launch_native_host('http://127.0.0.1:8877/BASE.html', ROOT))
            launch.assert_not_called()

    def test_runtime_failure_does_not_claim_a_successful_launch(self):
        process = Mock()
        process.poll.return_value = 78
        with patch.object(native.subprocess, 'Popen', return_value=process):
            self.assertFalse(native.launch_native_host('http://127.0.0.1:8877/BASE.html', ROOT))
        self.assertFalse(native._sessions)
        self.assertEqual(native.active_host_count(), 0)

    def test_slow_ready_never_terminates_a_live_host_and_accepts_a_late_ack(self):
        process = Mock()
        process.poll.return_value = None
        with patch.object(native.subprocess, 'Popen', return_value=process), \
                patch.object(native.time, 'monotonic', side_effect=[0, 31]), \
                patch.object(native.threading, 'Thread') as thread:
            self.assertTrue(native.launch_native_host('http://127.0.0.1:8877/BASE.html', ROOT))
            thread.return_value.start.assert_called_once_with()
        process.terminate.assert_not_called()
        token, event = next(iter(native._sessions.items()))
        self.assertTrue(native.notify_ready(token))
        native._clear_late_ready(token, event, process)
        self.assertNotIn(token, native._sessions)

    def test_late_ready_session_is_removed_after_its_process_exits(self):
        token = 'late-test'
        event, process = Mock(), Mock()
        event.wait.return_value = False
        process.poll.return_value = 0
        native._sessions[token] = event
        native._clear_late_ready(token, event, process)
        self.assertNotIn(token, native._sessions)

    def test_native_startup_failure_does_not_silently_open_old_browser_data(self):
        with patch.object(proxy, 'launch_native_host', return_value=False), \
                patch.object(proxy, 'host_executable', return_value=Path('AliothPDFHost.exe')), \
                patch.object(proxy, 'startup_failure_choice', return_value='cancel') as choice, \
                patch.object(proxy.time, 'sleep'), patch.object(proxy.subprocess, 'Popen') as launch:
            proxy.launch_browser(8877, [])
            choice.assert_called_once_with()
            launch.assert_not_called()

    def test_retry_native_startup_keeps_the_native_profile_and_skips_browser_fallback(self):
        with patch.object(proxy, 'launch_native_host', side_effect=[False, True]) as native_launch, \
                patch.object(proxy, 'host_executable', return_value=Path('AliothPDFHost.exe')), \
                patch.object(proxy, 'startup_failure_choice', return_value='retry') as choice, \
                patch.object(proxy.time, 'sleep'), patch.object(proxy.subprocess, 'Popen') as launch:
            proxy.launch_browser(8877, [])
            self.assertEqual(native_launch.call_count, 2)
            choice.assert_called_once_with()
            launch.assert_not_called()

    def test_transfer_retries_do_not_duplicate_records(self):
        session = MigrationSession()
        packet = {'sequence': 0, 'data': json.dumps({'buffer': [0, 255]}), 'last': True}
        session.publish(packet)
        session.publish(packet)
        self.assertEqual(session.queue.qsize(), 1)
        self.assertEqual(session.receive(0), packet)
        self.assertEqual(session.receive(0), packet)
        session.publish({'sequence': 1, 'done': True})
        self.assertTrue(session.receive(1)['done'])

    def test_transfer_rejects_out_of_order_or_oversized_packets(self):
        session = MigrationSession()
        with self.assertRaises(ValueError):
            session.publish({'sequence': 2, 'done': True})
        with self.assertRaises(ValueError):
            session.publish({'sequence': 0, 'data': 'x' * (4 * 1024 * 1024 + 1)})
        with self.assertRaises(ValueError):
            session.receive(1)

    def test_finished_transfer_cannot_be_reused(self):
        service = BrowserMigration(launcher=lambda url: None)
        with patch.object(service, '_close_exporter'):
            token = service.start('http://127.0.0.1:8877')
            service.finish(token)
            with self.assertRaises(KeyError):
                service.publish(token, {'sequence': 0, 'done': True})

    def test_hidden_exporter_can_still_be_closed_by_its_exact_token(self):
        controller = Mock()
        controller._find.return_value = 123
        with patch('_window_chrome.WindowChrome', return_value=controller):
            BrowserMigration._hide_exporter('a' * 32)
            controller._api.return_value.ShowWindow.assert_called_once_with(123, 0)
            BrowserMigration._close_exporter('a' * 32)
            controller._api.return_value.PostMessageW.assert_called_once_with(123, 0x10, 0, 0)
        for call in controller._find.call_args_list:
            self.assertFalse(call.kwargs['visible_only'])

    def test_only_live_migrations_count_as_active_clients(self):
        service = BrowserMigration(launcher=lambda url: None)
        token = service.start('http://127.0.0.1:8877')
        self.assertEqual(service.active_count(), 1)
        with patch('_browser_migration.time.monotonic', return_value=service.sessions[token].touched + 601):
            self.assertEqual(service.active_count(), 0)

    def test_migration_keeps_server_alive_past_initial_startup_timeout(self):
        clock = [0]
        def advance(seconds):
            clock[0] += seconds
            if clock[0] > 240:
                raise StopMonitor()
        cleanup = Mock()
        with patch.object(proxy, '_EVENT_QUEUES', {}), \
                patch.object(proxy.browser_migration, 'active_count', return_value=1), \
                patch.object(proxy.time, 'sleep', side_effect=advance), \
                patch.object(proxy.time, 'time', side_effect=lambda: clock[0]), \
                patch.object(proxy.os, '_exit') as terminate:
            with self.assertRaises(StopMonitor):
                proxy._client_monitor_loop(cleanup)
            terminate.assert_not_called()
            cleanup.assert_not_called()

    def test_new_migration_during_shutdown_grace_prevents_exit(self):
        with patch.object(proxy, '_EVENT_QUEUES', {}), \
                patch.object(proxy.browser_migration, 'active_count', side_effect=[1, 0, 1, StopMonitor()]), \
                patch.object(proxy.time, 'sleep'), patch.object(proxy.os, '_exit') as terminate:
            with self.assertRaises(StopMonitor):
                proxy._client_monitor_loop(None)
            terminate.assert_not_called()

    def test_native_window_keeps_server_alive_after_migration_before_sse_connects(self):
        with patch.object(proxy, '_EVENT_QUEUES', {}), \
                patch.object(proxy.browser_migration, 'active_count', return_value=0), \
                patch.object(proxy, 'active_host_count', side_effect=[1, 1, StopMonitor()]), \
                patch.object(proxy.time, 'sleep'), patch.object(proxy.os, '_exit') as terminate:
            with self.assertRaises(StopMonitor):
                proxy._client_monitor_loop(None)
            terminate.assert_not_called()

    def test_server_still_exits_normally_without_clients_or_migration(self):
        cleanup = Mock()
        with patch.object(proxy, '_EVENT_QUEUES', {}), \
                patch.object(proxy.browser_migration, 'active_count', return_value=0), \
                patch.object(proxy.time, 'sleep'), patch.object(proxy.time, 'time', side_effect=[0, 121]), \
                patch.object(proxy.os, '_exit', side_effect=StopMonitor()) as terminate:
            with self.assertRaises(StopMonitor):
                proxy._client_monitor_loop(cleanup)
            terminate.assert_called_once_with(0)
            cleanup.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
