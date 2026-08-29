import pathlib
import json
import re
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# Load env
lines = pathlib.Path('.env').read_text().splitlines()
d = {}
for line in lines:
    if '=' in line and not line.strip().startswith('#'):
        k, v = line.split('=', 1)
        d[k.strip()] = v.strip()
url = d.get('EXPO_PUBLIC_SUPABASE_URL')
key = d.get('EXPO_PUBLIC_SUPABASE_ANON_KEY')
if not url or not key:
    raise SystemExit('Missing env variables')

endpoint = url.rstrip('/') + '/functions/v1/miga_stream'
payload = json.dumps({
    'user_id': 'test-user',
    'messages': [
        {
            'role': 'user',
            'content': 'Tell a story about the Delhi Sultanate with important exam points and concept summary in Hindi.'
        }
    ],
    'mode': 'story',
    'language_code': 'hi-IN',
    'language_label': 'Hindi',
    'provider': 'openrouter',
}).encode('utf-8')
req = Request(endpoint, data=payload, method='POST')
req.add_header('Content-Type', 'application/json')
req.add_header('Authorization', f'Bearer {key}')
req.add_header('apikey', key)

body = None
try:
    with urlopen(req, timeout=120) as resp:
        body = resp.read().decode('utf-8', errors='replace')
except HTTPError as e:
    print('HTTP_ERROR', e.code, e.reason)
    try:
        print(e.read().decode('utf-8', errors='replace'))
    except Exception as ex:
        print('ERROR_READING_BODY', ex)
    raise
except URLError as e:
    print('URL_ERROR', e)
    raise

# Parse token events
matches = re.findall(r'data: (\{.*?\})', body)
text = ''
for item in matches:
    try:
        obj = json.loads(item)
        if isinstance(obj, dict) and 'token' in obj:
            text += obj['token']
    except Exception:
        continue

path = pathlib.Path('scripts/story_mode_sample_response.txt')
path.write_text(text, encoding='utf-8')
print('WROTE', path)
print('LENGTH', len(text))
print('PREVIEW')
print(text[:10000])
