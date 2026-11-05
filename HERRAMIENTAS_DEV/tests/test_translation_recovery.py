import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('translation_recovery_proxy', ROOT / '_proxy.py')
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)


class PartialCheckpointTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory(prefix='alioth-partial-checkpoint-'))
        self.enterContext(patch.object(proxy, 'get_config_path', return_value=str(Path(directory) / 'config.ini')))
        self.data = {'operation': 'store', 'key': 'a' * 64, 'batchIndex': 0,
                     'expectedIds': ['u0', 'u1'], 'allowPartial': True}
        self.path = Path(directory) / 'translation-checkpoints' / ('a' * 64) / '0.dat'

    def load(self, partial=True):
        return proxy.translation_checkpoint({**self.data, 'operation': 'load', 'allowPartial': partial})

    def test_partial_checkpoint_is_encrypted_and_requires_opt_in(self):
        proxy.translation_checkpoint({**self.data, 'translations': {'u0': 'Private translation'}})
        self.assertNotIn('Private translation', self.path.read_text(encoding='ascii'))
        self.assertEqual(self.load(), {'u0': 'Private translation'})
        self.assertEqual(self.load(partial=False), {})

    def test_merging_partial_saves_retains_completed_ids(self):
        proxy.translation_checkpoint({**self.data, 'translations': {'u0': 'First'}})
        proxy.translation_checkpoint({**self.data, 'translations': {'u1': 'Second'}})
        self.assertEqual(self.load(partial=False), {'u0': 'First', 'u1': 'Second'})
        proxy.translation_checkpoint({**self.data, 'translations': {'u0': 'First'}})
        self.assertEqual(self.load(partial=False), {'u0': 'First', 'u1': 'Second'})

    def test_parallel_partial_saves_do_not_lose_progress(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(proxy.translation_checkpoint, [
                {**self.data, 'translations': {'u0': 'First'}},
                {**self.data, 'translations': {'u1': 'Second'}},
            ]))
        self.assertEqual(self.load(partial=False), {'u0': 'First', 'u1': 'Second'})

    def test_invalid_or_foreign_partial_entries_are_rejected(self):
        for values in [{}, {'foreign': 'Wrong ID'}, {'u0': ''}, {'u0': 'x' * 12001}]:
            with self.subTest(values=list(values)), self.assertRaises(ValueError):
                proxy.translation_checkpoint({**self.data, 'translations': values})
        with self.assertRaises(ValueError):
            proxy.translation_checkpoint({**self.data, 'allowPartial': 'yes', 'translations': {'u0': 'First'}})

    def test_complete_only_clients_keep_strict_validation(self):
        with self.assertRaises(ValueError):
            proxy.translation_checkpoint({**self.data, 'allowPartial': False, 'translations': {'u0': 'First'}})

    def test_mismatched_or_expired_checkpoint_is_not_reused(self):
        with patch.object(proxy.time, 'time', return_value=100):
            proxy.translation_checkpoint({**self.data, 'translations': {'u0': 'First'}})
        with patch.object(proxy.time, 'time', return_value=101):
            self.assertEqual(proxy.translation_checkpoint({**self.data, 'operation': 'load', 'expectedIds': ['u0']}), {})
        with patch.object(proxy.time, 'time', return_value=100 + 8 * 86400):
            self.assertEqual(self.load(), {})


class QuotaWaitTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.enterContext(patch.object(proxy.time, 'monotonic', side_effect=lambda: self.now))
        for name in ('_TRANSLATION_PROVIDER_RATE_LIMITS', '_TRANSLATION_PROVIDER_PROBES',
                     '_TRANSLATION_PROVIDER_COOLDOWNS', '_TRANSLATION_PROVIDER_QUOTA_STRIKES',
                     '_TRANSLATION_MODEL_STATES', '_TRANSLATION_CREDENTIAL_STATES'):
            self.enterContext(patch.object(proxy, name, {}))
        self.spec = ('groq', ['test-key'], 'https://groq.invalid/chat', ('test-model',))

    def test_provider_wait_honors_long_retry_after(self):
        proxy._translation_cool_down_quota(*self.spec, 217)
        self.assertEqual(proxy._translation_quota_wait(*self.spec), 217)
        self.now = 100
        self.assertEqual(proxy._translation_quota_wait(*self.spec), 117)

    def test_all_batches_observe_the_same_provider_wait(self):
        proxy._translation_cool_down_quota(*self.spec, 217)
        budgets = [proxy._TranslationGenerationBudget() for _ in range(2)]
        for budget in budgets:
            self.assertEqual(proxy._translation_ready_providers([self.spec], budget), set())
            self.assertEqual(budget.retry_after_seconds, 217)

    def test_changed_credentials_invalidate_old_quota_wait(self):
        proxy._translation_cool_down_quota(*self.spec, 217)
        changed = ('groq', ['new-test-key'], self.spec[2], self.spec[3])
        self.assertEqual(proxy._translation_quota_wait(*changed), 0)

    def test_handler_returns_full_wait_without_network_attempts(self):
        self.enterContext(patch.object(proxy, 'GEMINI_KEYS', []))
        self.enterContext(patch.object(proxy, '_TEXT_PROVIDER_SPECS', (self.spec,)))
        proxy._translation_cool_down_quota(*self.spec, 217)
        handler = object.__new__(proxy.AliothHandler)
        handler._read_body = lambda: json.dumps({'prompt': 'Private text', 'task': 'translation'})
        handler._send_json = lambda status, result: (status, result)
        handler._send_error = lambda status, message: (status, {'error': message})
        with patch.object(proxy.urllib.request, 'urlopen') as network, contextlib.redirect_stdout(io.StringIO()):
            status, result = handler._generate_ai_json()
        self.assertEqual(status, 503)
        self.assertEqual(result['error'], 'PROVIDER_RATE_LIMITED')
        self.assertEqual(result['retryAfterSeconds'], 217)
        self.assertEqual(result['attempts'], 0)
        network.assert_not_called()

    def test_successful_fallback_reports_quota_pressure(self):
        handler = object.__new__(proxy.AliothHandler)
        handler._read_body = lambda: json.dumps({'prompt': 'Private text', 'task': 'translation'})
        handler._send_json = lambda status, result: (status, result)
        handler._send_error = lambda status, message: (status, {'error': message})
        def generate(prompt, temperature, budget):
            budget.failures.add('PROVIDER_RATE_LIMITED')
            return '[]', 'groq', 'fallback-model'
        with patch.object(proxy, '_generate_text_json_with_fallback', side_effect=generate):
            status, result = handler._generate_ai_json()
        self.assertEqual(status, 200)
        self.assertTrue(result['rateLimited'])
        self.assertEqual(result['text'], '[]')


if __name__ == '__main__':
    unittest.main()
