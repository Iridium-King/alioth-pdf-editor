import io
import json
from pathlib import Path
import sys
import unittest
import urllib.error
import threading
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import _proxy as proxy


class AIChatFallbackTests(unittest.TestCase):
    def setUp(self):
        self.attempts = []
        self.gemini_models = ['gemini-principal', 'gemini-respaldo']
        self.failures = set()
        self.cancelled = None
        self.enterContext(patch.multiple(
            proxy, GEMINI_KEYS=['gemini-test-key'],
            _TEXT_PROVIDER_SPECS=(('groq', ['groq-test-key'], 'https://api.groq.com/openai/v1/chat/completions', ('groq-texto',)),),
            _TRANSLATION_MODEL_STATES={}, _TRANSLATION_CREDENTIAL_STATES={},
            _TRANSLATION_PROVIDER_COOLDOWNS={}, _TRANSLATION_PROVIDER_RATE_LIMITS={},
            _TRANSLATION_PROVIDER_QUOTA_STRIKES={}, _TRANSLATION_PROVIDER_PROBES={},
        ))
        self.enterContext(patch.object(proxy, '_list_gemini_models', return_value=self.gemini_models))
        self.enterContext(patch.object(proxy, '_list_gemini_vision_models', return_value=self.gemini_models))
        self.enterContext(patch.object(proxy, '_list_groq_vision_models', return_value=['groq-imagen']))
        self.enterContext(patch.object(proxy.urllib.request, 'urlopen', side_effect=self.reply))

    def reply(self, request, **kwargs):
        body = json.loads(request.data)
        is_gemini = 'googleapis' in request.host
        model = request.selector.split('/models/')[1].split(':')[0] if is_gemini else body['model']
        self.attempts.append((model, body))
        self.assertLessEqual(kwargs['timeout'], 9 if 'inline_data' in str(body) else 10)
        if self.cancelled:
            self.cancelled.set()
        if model in self.failures:
            raise urllib.error.HTTPError(request.full_url, 503, 'High demand', {}, io.BytesIO(b'{}'))
        data = (
            {'candidates': [{'content': {'parts': [{'text': 'Respuesta de prueba.'}]}}]}
            if is_gemini else {'choices': [{'message': {'content': 'Respuesta de prueba.'}}]}
        )
        return io.BytesIO(json.dumps(data).encode())

    def test_servicio_ocupado_prueba_otro_modelo_de_gemini(self):
        self.failures.add('gemini-principal')
        self.assertEqual(proxy._generate_chat_with_fallback('Pregunta', [], 'gemini'), 'Respuesta de prueba.')
        self.assertEqual([model for model, _ in self.attempts], self.gemini_models)

    def test_todos_los_modelos_ocupados_prueba_otro_proveedor_configurado(self):
        self.failures.update(self.gemini_models)
        self.assertEqual(proxy._generate_chat_with_fallback('Pregunta', [], 'gemini'), 'Respuesta de prueba.')
        self.assertEqual([model for model, _ in self.attempts], self.gemini_models + ['groq-texto'])
        self.assertEqual(self.attempts[-1][1]['messages'], [{'role': 'user', 'content': 'Pregunta'}])

    def test_fallback_de_vision_conserva_la_imagen(self):
        self.failures.update(self.gemini_models)
        sample = '/9j/2Q=='
        self.assertEqual(proxy._generate_chat_with_fallback('Pregunta visual', [sample], 'gemini'), 'Respuesta de prueba.')
        model, body = self.attempts[-1]
        self.assertEqual(model, 'groq-imagen')
        self.assertEqual(body['messages'][0]['content'][1]['image_url']['url'], 'data:image/jpeg;base64,' + sample)

    def test_preferencia_del_usuario_se_usa_primero(self):
        self.assertEqual(proxy._generate_chat_with_fallback('Pregunta', [], 'groq'), 'Respuesta de prueba.')
        self.assertEqual([model for model, _ in self.attempts], ['groq-texto'])

    def test_ausencia_de_claves_no_contacta_proveedores(self):
        with patch.multiple(proxy, GEMINI_KEYS=[], _TEXT_PROVIDER_SPECS=()):
            with self.assertRaisesRegex(RuntimeError, 'PROVIDER_KEY_REQUIRED'):
                proxy._generate_chat_with_fallback('Pregunta', [], 'gemini')
        self.assertEqual(self.attempts, [])

    def test_detener_evita_intentos_posteriores(self):
        self.cancelled = threading.Event()
        self.failures.add('gemini-principal')
        with self.assertRaises(proxy._AIChatCancelled):
            proxy._generate_chat_with_fallback('Pregunta', [], 'gemini', cancelled=self.cancelled)
        self.assertEqual([model for model, _ in self.attempts], ['gemini-principal'])


if __name__ == '__main__':
    unittest.main()
