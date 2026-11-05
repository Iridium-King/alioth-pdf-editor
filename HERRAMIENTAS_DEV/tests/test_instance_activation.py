import configparser
import json
from pathlib import Path
import queue
import sys
import threading
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _proxy as proxy


class InstanceActivationTests(unittest.TestCase):
    def setUp(self):
        self.server = proxy.AliothHTTPServer(('127.0.0.1', 0), proxy.AliothHandler)
        self.port = self.server.server_address[1]
        self.origin = f'http://127.0.0.1:{self.port}'
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(self.stop_server)
        for name, value in [('_ACTIVE_PORT', self.port), ('_ALLOWED_ORIGINS', {self.origin}),
                            ('_EVENT_QUEUES', {}), ('_WINDOW_LAUNCH_PENDING', 0)]:
            guard = patch.object(proxy, name, value)
            guard.start()
            self.addCleanup(guard.stop)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(3)

    def test_reopen_is_delegated_to_the_server_without_launching_in_the_forwarder(self):
        with patch.object(proxy, '_find_active_instance', return_value=self.port), \
                patch.object(proxy, 'request_local_window') as activate, \
                patch.object(proxy, 'launch_browser') as launch:
            self.assertTrue(proxy.check_existing_instance_and_forward([]))
            activate.assert_called_once_with(None, False)
            launch.assert_not_called()

    def test_pdf_without_a_window_is_launched_by_the_existing_server(self):
        pdf = str(Path(__file__).resolve().parents[2] / '_qa_activation.pdf')
        with patch.object(proxy, '_find_active_instance', return_value=self.port), \
                patch.object(proxy, 'load_config', return_value=configparser.ConfigParser()), \
                patch.object(proxy, 'request_local_window') as activate, \
                patch.object(proxy, 'launch_browser') as launch:
            self.assertTrue(proxy.check_existing_instance_and_forward([pdf]))
            activate.assert_called_once_with(pdf, False)
            launch.assert_not_called()

    def test_pdf_is_sent_once_to_the_existing_tab_and_activation_knows_it_was_queued(self):
        events = queue.Queue()
        pdf = str(Path(__file__).resolve().parents[2] / '_qa_activation.pdf')
        with patch.object(proxy, '_find_active_instance', return_value=self.port), \
                patch.object(proxy, '_EVENT_QUEUES', {'active': events}), \
                patch.object(proxy, 'load_config', return_value=configparser.ConfigParser()), \
                patch.object(proxy, 'activate_browser_window', return_value=True), \
                patch.object(proxy, 'request_local_window') as activate:
            self.assertTrue(proxy.check_existing_instance_and_forward([pdf]))
            self.assertEqual(events.qsize(), 1)
            self.assertEqual(events.get_nowait()['path'], pdf)
            activate.assert_called_once_with(pdf, True)

    def test_older_or_unavailable_server_does_not_create_an_orphan_window(self):
        with patch.object(proxy, '_find_active_instance', return_value=self.port), \
                patch.object(proxy.urllib.request, 'urlopen', side_effect=urllib.error.URLError('unavailable')), \
                patch.object(proxy, 'launch_browser') as launch:
            self.assertFalse(proxy.check_existing_instance_and_forward([]))
            launch.assert_not_called()

    def test_activation_rejects_external_origin_and_non_pdf_payloads(self):
        with patch.object(proxy, 'request_local_window') as activate:
            for origin, payload, expected in [('https://example.invalid', {}, 403),
                    (self.origin, {'path': 'script.exe'}, 400), (self.origin, {'queued': 'yes'}, 400)]:
                request = urllib.request.Request(self.origin + '/api/activate-window',
                    data=json.dumps(payload).encode(), headers={'Origin': origin})
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request, timeout=3)
                self.assertEqual(error.exception.code, expected)
                error.exception.close()
            activate.assert_not_called()

    def test_pending_launch_keeps_server_alive_until_host_is_created(self):
        with patch.object(proxy.threading, 'Thread') as thread, \
                patch.object(proxy, 'activate_browser_window', return_value=False), \
                patch.object(proxy, 'launch_browser') as launch:
            proxy.request_local_window('sample.pdf')
            self.assertEqual(proxy.pending_window_count(), 1)
            thread.call_args.kwargs['target']()
            launch.assert_called_once_with(self.port, ['sample.pdf'])
            self.assertEqual(proxy.pending_window_count(), 0)

    def test_queued_pdf_does_not_open_twice_and_missing_window_receives_the_file(self):
        with patch.object(proxy.threading, 'Thread') as thread, \
                patch.object(proxy, 'activate_browser_window', side_effect=[True, False]), \
                patch.object(proxy, 'launch_browser') as launch:
            proxy.request_local_window('sample.pdf', queued=True)
            thread.call_args.kwargs['target']()
            launch.assert_not_called()
            proxy.request_local_window('sample.pdf', queued=True)
            thread.call_args.kwargs['target']()
            launch.assert_called_once_with(self.port, ['sample.pdf'])
            self.assertEqual(proxy.pending_window_count(), 0)

    def test_failed_thread_start_releases_the_startup_lease(self):
        with patch.object(proxy.threading, 'Thread') as thread:
            thread.return_value.start.side_effect = RuntimeError('start failed')
            with self.assertRaises(RuntimeError):
                proxy.request_local_window()
            self.assertEqual(proxy.pending_window_count(), 0)

    def test_launch_accepted_at_shutdown_boundary_preserves_server_and_bundle(self):
        cleanup = Mock()
        with patch.object(proxy, '_WINDOW_LAUNCH_PENDING', 1), \
                patch.object(proxy.os, '_exit') as terminate:
            proxy._stop_idle_server(cleanup)
            cleanup.assert_not_called()
            terminate.assert_not_called()

    def test_server_rechecks_native_windows_before_deleting_runtime_files(self):
        cleanup = Mock()
        with patch.object(proxy, 'active_host_count', return_value=1), \
                patch.object(proxy.os, '_exit') as terminate:
            proxy._stop_idle_server(cleanup)
            cleanup.assert_not_called()
            terminate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
