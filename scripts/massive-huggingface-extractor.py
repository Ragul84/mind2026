import os
import sys
import json
import hashlib
import requests
from pathlib import Path
from dotenv import load_dotenv

# Reconfigure stdout to use UTF-8 just in case, to prevent windows encoding issues
try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass  # In case sys.stdout doesn't support reconfigure

# Load env from parent directory
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

REDIS_URL = os.getenv("EXPO_PUBLIC_UPSTASH_REDIS_REST_URL")
REDIS_TOKEN = os.getenv("EXPO_PUBLIC_UPSTASH_REDIS_REST_TOKEN")

if not REDIS_URL or not REDIS_TOKEN:
    print("[Error] Missing Redis credentials in .env file.")
    sys.exit(1)

# Mapping dictionary for keywords to Redis keys
KEYWORD_MAPPING = {
    "polity": ["constitution", "parliament", "amendment", "fundamental rights", "article ", "president of india", "supreme court", "governance", "dpsp"],
    "geography": ["river", "ocean", "monsoon", "soil", "climate", "mountain", "equator", "latitude", "longitude", "continent"],
    "science": ["cell", "molecule", "atom", "reaction", "acid", "organelle", "gravity", "energy", "force", "virus", "bacteria", "ecosystem"],
    "history": ["veda", "harappan", "dynasty", "revolt of 1857", "british", "mughal", "delhi sultanate", "battle of", "empire", "ashoka"],
    "economics": ["gdp", "inflation", "monetary policy", "rbi", "budget", "fiscal", "taxation", "wto", "imf", "growth", "interest rate"],
    "english": ["synonym", "antonym", "preposition", "grammar", "vocabulary", "tense", "passive voice", "indirect speech"],
    "maths": ["lcm", "hcf", "percentage", "profit", "loss", "interest", "probability", "algebra", "mensuration", "trigonometry", "ratio"],
    "reasoning": ["series", "pattern", "coding-decoding", "blood relation", "syllogism", "direction", "puzzle", "venn diagram"],
    "computer": ["operating system", "network", "database", "ram", "cpu", "binary", "software", "hardware", "internet"]
}

# Track duplicates using MD5 hashes in a set
seen_hashes = set()

def get_question_hash(question_text):
    return hashlib.md5(question_text.strip().lower().encode('utf-8')).hexdigest()

def classify_subject(prompt_text):
    text_lower = prompt_text.lower()
    for subject, keywords in KEYWORD_MAPPING.items():
        for keyword in keywords:
            if keyword in text_lower:
                return subject
    return "general_knowledge"  # Fallback key

def extract_mcq_data(prompt, complex_cot, response):
    """
    Parses a prompt containing an MCQ into clean Question, Options, Answer Index and Explanation.
    Handles multiple prompt structures commonly found in ExamBench.
    """
    try:
        # Simple heuristic parser for prompt containing multiple choice questions
        lines = prompt.split('\n')
        question_text = ""
        options = []
        
        # Look for option prefixes (e.g., A), B), C), D) or 1., 2., 3., 4. or (A), (B), etc.)
        option_prefixes = [("a)", "b)", "c)", "d)"), 
                           ("a.", "b.", "c.", "d."), 
                           ("(a)", "(b)", "(c)", "(d)"),
                           ("1.", "2.", "3.", "4.")]
        
        # Try to find standard format
        for line in lines:
            line_strip = line.strip()
            if not line_strip:
                continue
            
            # Identify if it is an option line
            is_option = False
            for prefixes in option_prefixes:
                if any(line_strip.lower().startswith(p) for p in prefixes):
                    is_option = True
                    # Strip prefix to get clean option text
                    for p in prefixes:
                        if line_strip.lower().startswith(p):
                            clean_opt = line_strip[len(p):].strip()
                            options.append(clean_opt)
                            break
                    break
            
            if not is_option and len(options) == 0:
                question_text += " " + line_strip
        
        question_text = question_text.strip()
        
        if not question_text or len(options) < 2:
            # If standard heuristic fails, fallback to simple parsing
            return None
            
        # Parse the correct answer index from the response or complex_cot
        # Common patterns: "Correct Answer: A", "Answer is (C)", etc.
        answer_text = (response + " " + complex_cot).lower()
        correct_index = 0  # Default fallback to A
        
        if "correct option is a" in answer_text or "answer is a" in answer_text or "correct answer: a" in answer_text:
            correct_index = 0
        elif "correct option is b" in answer_text or "answer is b" in answer_text or "correct answer: b" in answer_text:
            correct_index = 1
        elif "correct option is c" in answer_text or "answer is c" in answer_text or "correct answer: c" in answer_text:
            correct_index = 2
        elif "correct option is d" in answer_text or "answer is d" in answer_text or "correct answer: d" in answer_text:
            correct_index = 3
        else:
            # Fallback check for single letters or reasoning keywords
            if "option a" in answer_text: correct_index = 0
            elif "option b" in answer_text: correct_index = 1
            elif "option c" in answer_text: correct_index = 2
            elif "option d" in answer_text: correct_index = 3
            
        # Clean up explanation: strip formatting, keep it under 200 chars if possible or take summary
        explanation = complex_cot.strip().split("Step-by-Step Explanation:")[0].strip()
        if not explanation:
            explanation = response.strip()
            
        # Limit explanation length for database efficiency
        if len(explanation) > 300:
            explanation = explanation[:297] + "..."

        return {
            "question": question_text,
            "options": options[:4] if len(options) >= 4 else (options + ["Option C", "Option D"])[:4],
            "answer_index": correct_index,
            "explanation": explanation,
            "difficulty": "medium"
        }
    except Exception as e:
        return None

def push_batch_to_redis(subject, questions):
    """
    Pushes a batch of questions to Redis using Upstash pipeline to avoid HTTP roundtrips.
    """
    if not questions:
        return
    
    key = f"quiz:subject:{subject}"
    serialized_questions = [json.dumps(q) for q in questions]
    
    # We chunk pipeline batches to 50 at a time to prevent body payload limit errors
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

def run_extraction(limit=5000):
    print("*** MINDGAINS HIGH-VOLUME EXTRACTOR & HYDRATOR ***")
    print(f"Targeting ingestion of up to {limit} clean MCQs from Hugging Face ExamBench...")
    
    offset = 0
    batch_limit = 100
    total_processed = 0
    
    # In-memory storage for batching before push
    batches = {sub: [] for sub in KEYWORD_MAPPING.keys()}
    batches["general_knowledge"] = []
    
    while total_processed < limit:
        url = f"https://datasets-server.huggingface.co/rows?dataset=shravan01/exambench&config=default&split=train&offset={offset}&limit={batch_limit}"
        try:
            response = requests.get(url, timeout=15)
            if response.status_code != 200:
                print(f"[Warning] Hugging Face API returned status code {response.status_code}. Stopping.")
                break
                
            data = response.json()
            rows = data.get("rows", [])
            if not rows:
                print("[Info] No more rows available in dataset.")
                break
                
            print(f"[Batch] Fetched batch offset {offset} ({len(rows)} records)...")
            
            for row in rows:
                row_data = row.get("row", {})
                prompt = row_data.get("prompt", "")
                complex_cot = row_data.get("complex_cot", "")
                res_text = row_data.get("response", "")
                
                # Check for duplicates
                q_hash = get_question_hash(prompt)
                if q_hash in seen_hashes:
                    continue
                seen_hashes.add(q_hash)
                
                # Parse
                parsed = extract_mcq_data(prompt, complex_cot, res_text)
                if parsed:
                    subject = classify_subject(prompt)
                    batches[subject].append(parsed)
                    total_processed += 1
                    
                    if total_processed >= limit:
                        break
            
            # Periodically flush batches to Redis to manage memory
            for sub, items in batches.items():
                if len(items) >= 50:
                    push_batch_to_redis(sub, items)
                    batches[sub] = []
                    
            offset += len(rows)
            
        except Exception as e:
            print(f"[Error] Error during request: {e}")
            break
            
    # Flush remaining questions
    print("[Info] Ingestion complete. Flushing remaining items in memory to database...")
    for sub, items in batches.items():
        if items:
            push_batch_to_redis(sub, items)
            
    print(f"[Success] Ingestion complete. Hydrated {total_processed} unique questions into the database!")

if __name__ == "__main__":
    # You can pass limit as command line argument
    limit_to_fetch = 2000
    if len(sys.argv) > 1:
        try:
            limit_to_fetch = int(sys.argv[1])
        except ValueError:
            pass
    run_extraction(limit_to_fetch)
