import contextlib
import importlib.util
import io
import json
import sys
import threading
import unittest
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('translation_speed_proxy', ROOT / '_proxy.py')
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)


class TranslationModelTests(unittest.TestCase):
    key = 'test-groq'
    endpoint = 'https://api.groq.com/openai/v1/chat/completions'
    models = ('openai/gpt-oss-20b', 'openai/gpt-oss-120b')
    complete = '[{"unitId":"u0","translatedText":"Texto de prueba"}]'

    def setUp(self):
        self.enterContext(patch.multiple(
            proxy, _TRANSLATION_GROQ_CATALOGUES={}, _TRANSLATION_GROQ_REFRESHING=set(),
            _TRANSLATION_MODEL_RESULTS={}, _TRANSLATION_MODEL_STATES={},
            _TRANSLATION_CREDENTIAL_STATES={}, _TRANSLATION_PROVIDER_COOLDOWNS={},
            _TRANSLATION_PROVIDER_RATE_LIMITS={}, _TRANSLATION_PROVIDER_PROBES={},
            _TRANSLATION_PROVIDER_QUOTA_STRIKES={}
        ))

    def test_groq_translation_parameters_do_not_reach_panel_chat(self):
        payload = {'choices': [{'message': {'content': self.complete}}]}
        captured = []

        def send(request, **kwargs):
            captured.append(json.loads(request.data))
            return io.BytesIO(json.dumps(payload).encode())

        with patch.object(proxy.urllib.request, 'urlopen', side_effect=send), \
                patch.object(proxy, '_translation_groq_models', return_value=self.models) as catalogue, \
                patch.object(proxy, '_TEXT_PROVIDER_SPECS', (('groq', [self.key], self.endpoint, self.models),)), \
                patch.object(proxy, 'GEMINI_KEYS', []):
            budget = proxy._TranslationGenerationBudget()
            budget.expected_translation_ids = {'u0'}
            self.assertEqual(proxy._generate_text_json_with_fallback('Prueba', budget=budget)[2], self.models[0])
            self.assertEqual(proxy._generate_chat_with_fallback('Pregunta', [], 'groq'), self.complete)
            catalogue.assert_called_once()
        self.assertEqual(captured[0]['reasoning_effort'], 'low')
        self.assertEqual(captured[0]['max_completion_tokens'], 4096)
        self.assertNotIn('reasoning_effort', captured[1])
        self.assertNotIn('max_completion_tokens', captured[1])
        self.assertEqual(captured[1]['messages'], [{'role': 'user', 'content': 'Pregunta'}])

    def test_catalogue_refresh_is_background_and_key_specific(self):
        started = threading.Event()
        release = threading.Event()
        actual = proxy._refresh_translation_groq_catalogue
        finished = threading.Event()

        def fetch(key, timeout):
            started.set()
            self.assertTrue(release.wait(5))
            return [{'id': self.models[0], 'active': False}, {'id': self.models[1], 'active': True},
                    {'id': 'unknown-unverified-model', 'active': True}]

        def refresh(*args):
            try:
                actual(*args)
            finally:
                finished.set()

        with patch.object(proxy, '_read_groq_catalogue', side_effect=fetch) as catalogue, \
                patch.object(proxy, '_refresh_translation_groq_catalogue', side_effect=refresh):
            try:
                self.assertEqual(proxy._translation_groq_models(self.key, self.models), self.models)
                self.assertTrue(started.wait(5))
                self.assertEqual(proxy._translation_groq_models(self.key, self.models), self.models)
            finally:
                release.set()
                self.assertTrue(finished.wait(5))
            self.assertEqual(proxy._translation_groq_models(self.key, self.models), [self.models[1]])
            catalogue.assert_called_once_with(self.key, 3)
        self.assertNotIn(proxy._translation_model_identity('groq', 'another-key', ''), proxy._TRANSLATION_GROQ_CATALOGUES)

    def test_retired_model_skips_next_attempt_without_quota_delay(self):
        payload = {'choices': [{'message': {'content': self.complete}}]}
        attempted = []

        def send(request, **kwargs):
            model = json.loads(request.data)['model']
            attempted.append(model)
            if model == self.models[0]:
                raise urllib.error.HTTPError(request.full_url, 410, 'retired', {}, io.BytesIO())
            return io.BytesIO(json.dumps(payload).encode())

        def generate():
            return proxy._openai_generate_json('groq', [self.key], self.endpoint, self.models, 'Prueba', 0,
                                               budget=proxy._TranslationGenerationBudget(), translation=True)

        with patch.object(proxy.urllib.request, 'urlopen', side_effect=send), \
                patch.object(proxy, '_translation_groq_models', return_value=self.models) as catalogue:
            self.assertEqual(generate()[2], self.models[1])
            self.assertEqual(generate()[2], self.models[1])
            catalogue.assert_any_call(self.key, self.models, refresh=True)
        self.assertEqual(attempted, [self.models[0], self.models[1], self.models[1]])

    def test_verified_coverage_dominates_a_fast_incomplete_response(self):
        for _ in range(2):
            proxy._translation_record_model_result('groq', self.key, self.models[0], {'u0'}, '[]', 0.1)
            proxy._translation_record_model_result('groq', self.key, self.models[1], {'u0'}, self.complete, 0.4)
        self.assertEqual(proxy._order_translation_models('groq', self.key, self.models), list(reversed(self.models)))
        self.assertEqual(proxy._order_translation_models('groq', 'another-key', self.models), list(self.models))


class TranslationSpeedTests(unittest.TestCase):
    def setUp(self):
        self.now = 100
        self.calls = []
        self.enterContext(patch.object(proxy.time, 'monotonic', side_effect=lambda: self.now))
        for name in ('_TRANSLATION_PROVIDER_COOLDOWNS', '_TRANSLATION_PROVIDER_RATE_LIMITS',
                     '_TRANSLATION_PROVIDER_QUOTA_STRIKES', '_TRANSLATION_PROVIDER_PROBES',
                     '_TRANSLATION_MODEL_STATES', '_TRANSLATION_CREDENTIAL_STATES', '_GEMINI_MODEL_CACHE'):
            self.enterContext(patch.object(proxy, name, {}))
        self.enterContext(patch.object(proxy, '_TRANSLATION_PROVIDER_PREFERENCE', None))
        self.enterContext(patch.object(proxy, 'GEMINI_KEYS', ['test-gemini']))
        self.enterContext(patch.object(proxy, '_TEXT_PROVIDER_SPECS', (
            ('groq', ['test-groq'], 'https://groq.invalid/chat', ('groq-test',)),
            ('mistral', ['test-mistral'], 'https://mistral.invalid/chat', ('mistral-test',)),
        )))
        self.openai = self.enterContext(patch.object(proxy, '_openai_generate_json', side_effect=self.compatible))
        self.gemini = self.enterContext(patch.object(proxy, '_gemini_generate_json', side_effect=self.google))
        self.output = io.StringIO()
        self.enterContext(contextlib.redirect_stdout(self.output))

    def compatible(self, provider, *args, **kwargs):
        self.calls.append(provider)
        return ('[]', provider, provider + '-test') if kwargs.get('budget') else ('[]', provider)

    def google(self, *args, **kwargs):
        self.calls.append('gemini')
        return {'candidates': [{'content': {'parts': [{'text': '[]'}]}}]}, 'gemini-test'

    def generate(self, translation=True):
        return proxy._generate_text_json_with_fallback(
            'private test text', budget=proxy._TranslationGenerationBudget() if translation else None)

    def prefer_gemini(self):
        self.openai.side_effect = RuntimeError('unavailable')
        self.assertEqual(self.generate()[1], 'gemini')
        self.openai.side_effect = self.compatible
        self.calls.clear()

    def test_translation_tries_groq_first(self):
        self.assertEqual(self.generate()[1], 'groq')
        self.assertEqual(self.calls, ['groq'])
        self.assertNotIn('private test text', self.output.getvalue())

    def test_other_ai_tasks_keep_gemini_first(self):
        self.generate()
        self.calls.clear()
        self.assertEqual(self.generate(translation=False)[1], 'gemini')
        self.assertEqual(self.calls, ['gemini'])

    def test_missing_groq_keeps_gemini_available(self):
        proxy._TEXT_PROVIDER_SPECS = ()
        self.assertEqual(self.generate()[1], 'gemini')

    def test_working_backup_is_remembered(self):
        self.prefer_gemini()
        self.assertEqual(self.generate()[1], 'gemini')
        self.assertEqual(self.calls, ['gemini'])

    def test_preference_expires(self):
        self.prefer_gemini()
        self.now += proxy._TRANSLATION_PROVIDER_PREFERENCE_SECONDS + 1
        self.assertEqual(self.generate()[1], 'groq')

    def test_rotating_credentials_invalidates_preference(self):
        self.prefer_gemini()
        proxy.GEMINI_KEYS = ['rotated-test-key']
        self.assertEqual(self.generate()[1], 'groq')

    def test_changing_model_or_endpoint_invalidates_preference(self):
        self.prefer_gemini()
        proxy._TEXT_PROVIDER_SPECS = (
            ('groq', ['test-groq'], 'https://groq.invalid/new', ('new-model',)),)
        self.assertEqual(self.generate()[1], 'groq')

    def test_failed_preferred_provider_uses_and_remembers_backup(self):
        self.generate()
        self.openai.side_effect = RuntimeError('unavailable')
        self.assertEqual(self.generate()[1], 'gemini')
        self.openai.side_effect = self.compatible
        self.calls.clear()
        self.generate()
        self.assertEqual(self.calls, ['gemini'])

    def test_cooled_provider_is_skipped_even_when_preferred(self):
        self.generate()
        proxy._translation_cool_down_provider(*proxy._TEXT_PROVIDER_SPECS[0])
        self.calls.clear()
        self.assertEqual(self.generate()[1], 'gemini')
        self.assertEqual(self.calls, ['gemini'])

    def test_missing_credentials_keep_distinct_error(self):
        proxy.GEMINI_KEYS = []
        proxy._TEXT_PROVIDER_SPECS = ()
        with self.assertRaisesRegex(RuntimeError, 'PROVIDER_KEY_REQUIRED'):
            self.generate()
        self.assertEqual(self.calls, [])

    def test_all_failures_preserve_budget_error(self):
        def fail(*args, **kwargs):
            kwargs['budget'].record_failure(TimeoutError())
            raise TimeoutError()
        self.openai.side_effect = self.gemini.side_effect = fail
        with self.assertRaisesRegex(RuntimeError, 'PROVIDER_TIMEOUT'):
            self.generate()

    def test_parallel_requests_preserve_a_usable_preference(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.generate(), range(12)))
        self.assertTrue(all(result[1] == 'groq' for result in results))


if __name__ == '__main__':
    unittest.main()
