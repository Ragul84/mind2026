import pathlib
import json
import ssl
import struct
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

lines = pathlib.Path('.env').read_text().splitlines()
d = {}
for line in lines:
    if '=' in line and not line.strip().startswith('#'):
        k, v = line.split('=', 1)
        d[k.strip()] = v.strip()

url = d.get('EXPO_PUBLIC_SUPABASE_URL') or d.get('SUPABASE_URL')
key = d.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') or d.get('SUPABASE_ANON_KEY')
if not url or not key:
    raise SystemExit('Missing SUPABASE URL or ANON KEY')

endpoint = url.rstrip('/') + '/functions/v1/miga_tts'
text = 'This is a quick tutor test. Say it clearly in a calm tutoring voice.'
req = Request(endpoint, data=json.dumps({'text': text, 'language_code': 'en-IN'}).encode('utf-8'), method='POST')
req.add_header('Content-Type', 'application/json')
req.add_header('apikey', key)
req.add_header('Authorization', f'Bearer {key}')
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

try:
    with urlopen(req, context=ctx, timeout=120) as resp:
        data = resp.read()
        ct = resp.headers.get('Content-Type') or ''
        print('STATUS', resp.status)
        print('CONTENT-TYPE', ct)
        print('LENGTH_BYTES', len(data))
        if ct.startswith('audio/wav') and len(data) >= 44:
            hdr = data[:44]
            subchunk2size = struct.unpack('<I', hdr[40:44])[0]
            sample_rate = struct.unpack('<I', hdr[24:28])[0]
            num_channels = struct.unpack('<H', hdr[22:24])[0]
            bits_per_sample = struct.unpack('<H', hdr[34:36])[0]
            duration = subchunk2size / (sample_rate * num_channels * bits_per_sample / 8)
            print('ESTIMATED_SECONDS', duration)
        elif ct.startswith('audio/mpeg'):
            print('ESTIMATED_SECONDS', 'mp3 file received, cannot compute exact duration without an audio parser in this environment.')
        else:
            print('RAW_RESPONSE', data.decode('utf-8', errors='replace')[:1000])
except HTTPError as e:
    print('HTTP_ERROR', e.code, e.reason)
    try:
        print(e.read().decode('utf-8', errors='replace'))
    except Exception:
        pass
except URLError as e:
    print('URL_ERROR', e)
