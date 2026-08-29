import os
import sys
import json
import hashlib
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load env from parent directory
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

REDIS_URL = os.getenv("EXPO_PUBLIC_UPSTASH_REDIS_REST_URL")
REDIS_TOKEN = os.getenv("EXPO_PUBLIC_UPSTASH_REDIS_REST_TOKEN")

if not REDIS_URL or not REDIS_TOKEN:
    print("[Error] Missing Redis credentials in .env file.")
    sys.exit(1)

# Import datasets here after pip install completes
try:
    from datasets import load_dataset
except ImportError:
    print("[Error] Hugging Face 'datasets' library is not installed. Please run pip install datasets.")
    sys.exit(1)

# MMLU Config to Redis subject mapping
MMLU_MAPPING = {
    "high_school_government_and_politics": "polity",
    "us_foreign_policy": "polity",
    "sociology": "polity",
    "security_studies": "polity",
    
    "high_school_geography": "geography",
    
    "high_school_us_history": "history",
    "high_school_world_history": "history",
    "high_school_european_history": "history",
    
    "high_school_macroeconomics": "economics",
    "high_school_microeconomics": "economics",
    "management": "economics",
    "marketing": "economics",
    "professional_accounting": "economics",
    
    "high_school_biology": "biology",
    "college_biology": "biology",
    
    "high_school_chemistry": "chemistry",
    "college_chemistry": "chemistry",
    
    "high_school_physics": "physics",
    "college_physics": "physics",
    
    "computer_security": "computer",
    "high_school_computer_science": "computer",
    "college_computer_science": "computer",
    
    "high_school_mathematics": "maths",
    "college_mathematics": "maths",
    "elementary_mathematics": "maths",
    "high_school_statistics": "maths",
    
    "logical_fallacies": "reasoning",
    "formal_logic": "reasoning"
}

seen_hashes = set()

def get_question_hash(question_text):
    return hashlib.md5(question_text.strip().lower().encode('utf-8')).hexdigest()

def push_batch_to_redis(subject, questions):
    """
    Pushes a batch of questions to Redis using Upstash pipeline.
    """
    if not questions:
        return
    
    key = f"quiz:subject:{subject}"
    serialized_questions = [json.dumps(q) for q in questions]
    
    chunk_size = 50
    for i in range(0, len(serialized_questions), chunk_size):
        chunk = serialized_questions[i:i+chunk_size]
        command = ["RPUSH", key] + chunk
        
        try:
            res = requests.post(
                REDIS_URL,
                headers={"Authorization": f"Bearer {REDIS_TOKEN}", "Content-Type": "application/json"},
                json=command
            )
            res_data = res.json()
            if "error" in res_data:
                print(f"[Redis Warning] Redis Error for {key}: {res_data['error']}")
            else:
                print(f"[Success] Pushed {len(chunk)} questions to {key} (Total list size: {res_data.get('result', 0)})")
        except Exception as e:
            print(f"[Error] Failed to push batch to Redis: {e}")

def run_mmlu_extraction(max_questions_per_config=500):
    print("*** MMLU MCQs EXTRACTOR & HYDRATOR ***")
    print(f"Targeting ingestion of up to {max_questions_per_config} questions per subject from cais/mmlu...")
    
    total_added = 0
    
    for mmlu_config, redis_subject in MMLU_MAPPING.items():
        print(f"\n[MMLU] Loading config '{mmlu_config}' for target subject '{redis_subject}'...")
        try:
            # We load the test split of MMLU which contains clean evaluation-grade questions
            dataset = load_dataset("cais/mmlu", mmlu_config, split="test")
            
            questions_to_push = []
            count = 0
            
            for row in dataset:
                question_text = row.get("question", "")
                choices = row.get("choices", [])
                correct_idx = row.get("answer", 0)
                
                if not question_text or len(choices) < 4:
                    continue
                
                # Check for duplicates
                q_hash = get_question_hash(question_text)
                if q_hash in seen_hashes:
                    continue
                seen_hashes.add(q_hash)
                
                formatted_question = {
                    "question": question_text,
                    "options": choices[:4],
                    "answer_index": correct_idx,
                    "explanation": f"Official verified question from MMLU ({mmlu_config.replace('_', ' ').title()}).",
                    "difficulty": "hard"
                }
                
                questions_to_push.append(formatted_question)
                count += 1
                total_added += 1
                
                if count >= max_questions_per_config:
                    break
            
            print(f"[MMLU] Collected {len(questions_to_push)} unique questions for {redis_subject}.")
            push_batch_to_redis(redis_subject, questions_to_push)
            
        except Exception as e:
            print(f"[MMLU Error] Failed to process config {mmlu_config}: {e}")
            
    print(f"\n[Success] MMLU Hydration Sync complete. Added {total_added} total unique questions to Redis!")

if __name__ == "__main__":
    limit = 200
    if len(sys.argv) > 1:
        try:
            limit = int(sys.argv[1])
        except ValueError:
            pass
    run_mmlu_extraction(limit)
