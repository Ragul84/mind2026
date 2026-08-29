import os
import json
import requests
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent / '.env'
load_dotenv(dotenv_path=env_path)

REDIS_URL = os.getenv("EXPO_PUBLIC_UPSTASH_REDIS_REST_URL")
REDIS_TOKEN = os.getenv("EXPO_PUBLIC_UPSTASH_REDIS_REST_TOKEN")

SUBJECTS = [
    "polity", "geography", "history", "economics", "biology",
    "chemistry", "physics", "computer", "maths", "reasoning"
]

def get_samples():
    print("=== LIVE MCQ SAMPLES FROM DATABASE ===")
    for sub in SUBJECTS:
        print(f"\n--- SUBJECT: {sub.upper()} ---")
        res = requests.post(
            REDIS_URL,
            headers={"Authorization": f"Bearer {REDIS_TOKEN}", "Content-Type": "application/json"},
            json=["LRANGE", f"quiz:subject:{sub}", "-2", "-1"]
        )
        results = res.json().get("result", [])
        if not results:
            print("  (No questions found)")
            continue
            
        for i, q_raw in enumerate(results):
            try:
                q = json.loads(q_raw)
                print(f"  Question {i+1}: {q['question']}")
                for idx, opt in enumerate(q['options']):
                    marker = "[X]" if idx == q['answer_index'] else "[ ]"
                    print(f"    {marker} ({chr(65+idx)}) {opt}")
                print(f"    Explanation: {q['explanation']}")
                print()
            except Exception as e:
                print(f"    (Error parsing question: {e})")

if __name__ == "__main__":
    get_samples()
