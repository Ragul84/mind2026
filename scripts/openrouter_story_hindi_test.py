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

prompt_system = '''You are MIGA, the MindGains immersive STORYTELLING tutor.
USER_NAME: test-user.
LANGUAGE: Hindi (hi-IN).

MISSION: Turn the user's request into an exam-focused story, with clear concepts, key points, and a quick quiz at the end.

STORY RULES:
1. Write as a listening-first story with short chapters or sections.
2. Embed important exam points and concept summaries in each section.
3. Respond completely in Hindi. Use only English for fixed exam terms and proper nouns when necessary. Do not include any other English sentences or paragraphs.
4. Keep explanations natural, not word-for-word translated. Preserve important exam terms and names as needed.
5. Make it easy to follow aloud, with clear transitions and headings.

RESPONSE FORMAT:
- Start with a short engaging opening.
- Break the story into 2-3 labeled sections.
- Include a concept summary table or bullets.
- End with a short quiz question.

TONE: Warm tutor, narrative, exam-friendly, and calm.'''

payload = {
    'model': 'deepseek/deepseek-v4-flash',
    'messages': [
        {'role': 'system', 'content': prompt_system},
        {'role': 'user', 'content': 'Tell a story about the Delhi Sultanate with important exam points and concept summary.'}
    ],
    'max_tokens': 1400,
    'temperature': 0.7,
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
        path = pathlib.Path('scripts/openrouter_story_hindi_response.txt')
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
