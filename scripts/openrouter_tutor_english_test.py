import pathlib
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

lines = pathlib.Path('.env').read_text().splitlines()
d = {}
for line in lines:
    if '=' in line and not line.strip().startswith('#'):
        k, v = line.split('=', 1)
        d[k.strip()] = v.strip()

api_key = d.get('OPENROUTER_API_KEY')
if not api_key:
    raise SystemExit('Missing OPENROUTER_API_KEY in .env')

prompt_system = '''You are MIGA, a live English tutor for Indian exam students and aspirants.
USER_NAME: test-user.
LANGUAGE: English (en-IN).

MISSION: Teach the user's requested topic in clear English and then ask exactly one short check question.

TUTOR RULES:
1. Keep the explanation short and spoken-sound natural.
2. Use simple English and exam-relevant terms.
3. Do not use Markdown or bullet lists unless the user asks.
4. Provide one useful check question at the end.

RESPONSE FORMAT:
- One brief explanation in English.
- One clear check question at the end.

TONE: Warm, patient, exam-smart tutor.'''

payload = {
    'model': d.get('OPENROUTER_MODEL', 'deepseek/deepseek-v4-flash'),
    'messages': [
        {'role': 'system', 'content': prompt_system},
        {'role': 'user', 'content': 'Explain the difference between active and passive voice in English and ask one short check question.'}
    ],
    'max_tokens': 800,
    'temperature': 0.6,
}

req = Request('https://openrouter.ai/api/v1/chat/completions', data=json.dumps(payload).encode('utf-8'), method='POST')
req.add_header('Content-Type', 'application/json')
req.add_header('Authorization', f'Bearer {api_key}')

try:
    with urlopen(req, timeout=120) as resp:
        body = resp.read().decode('utf-8', errors='replace')
        data = json.loads(body)
        choice = data['choices'][0]
        text = choice['message']['content']
        path = pathlib.Path('scripts/openrouter_tutor_english_response.txt')
        path.write_text(text, encoding='utf-8')
        print('WROTE', path)
        print('LENGTH', len(text))
        print('FINISH_REASON', choice.get('finish_reason'))
        print(text)
except HTTPError as e:
    print('HTTP_ERROR', e.code, e.reason)
    try:
        print(e.read().decode('utf-8', errors='replace'))
    except Exception:
        pass
except URLError as e:
    print('URL_ERROR', e)
