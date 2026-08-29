import pathlib
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# Load environment variables from .env
lines = pathlib.Path('.env').read_text().splitlines()
d = {}
for line in lines:
    if '=' in line and not line.strip().startswith('#'):
        k, v = line.split('=', 1)
        d[k.strip()] = v.strip()

url = d.get('EXPO_PUBLIC_SUPABASE_URL')
key = d.get('EXPO_PUBLIC_SUPABASE_ANON_KEY')
if not url or not key:
    raise SystemExit('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env')

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

print('=== REQUEST ===')
print(endpoint)
print('=== PAYLOAD ===')
print(payload.decode('utf-8'))

try:
    with urlopen(req, timeout=120) as resp:
        print('STATUS', resp.status)
        print('CONTENT-TYPE', resp.headers.get('Content-Type'))
        body = resp.read()
        text = body.decode('utf-8', errors='replace')
        print('BODY_LEN', len(body))
        print('BODY_PREVIEW')
        print(text)
except HTTPError as e:
    print('HTTP_ERROR', e.code, e.reason)
    try:
        print(e.read().decode('utf-8', errors='replace'))
    except Exception as ex:
        print('ERROR_READING_BODY', ex)
except URLError as e:
    print('URL_ERROR', e)
