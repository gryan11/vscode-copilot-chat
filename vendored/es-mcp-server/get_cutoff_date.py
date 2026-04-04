#!/usr/bin/env python3
"""Get the date cutoff for a task from pre-computed cutoff dates.

Reads METADATA_PATH to extract the solution commit hash, then looks up
the cutoff date from the vendored task_cutoff_dates.json file.

Fallback: solution commit date - 30 days.
"""
import json, os, re, subprocess, sys
from datetime import datetime, timedelta

def get_cutoff():
    metadata_path = os.environ.get("METADATA_PATH", "")
    repo_dir = os.environ.get("TESTBED_DIR", "/app")
    
    # Extract solution hash from metadata
    sol_hash = ""
    if metadata_path and os.path.exists(metadata_path):
        try:
            with open(metadata_path) as f:
                meta = json.load(f)
            instance_id = meta.get("instance_id", "")
            # Solution hash is the last 40-char hex segment
            m = re.search(r'([a-f0-9]{40})', instance_id.split("-v")[0][::-1])
            parts = instance_id.split("-")
            for p in reversed(parts):
                if len(p) == 40 and all(c in "0123456789abcdef" for c in p):
                    sol_hash = p
                    break
            if not sol_hash:
                # Try extracting from the full instance_id
                m = re.findall(r'[a-f0-9]{40}', instance_id)
                if m:
                    sol_hash = m[0]
        except Exception:
            pass

    # Try pre-computed cutoff dates
    cutoff_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "task_cutoff_dates.json")
    if sol_hash and os.path.exists(cutoff_file):
        try:
            with open(cutoff_file) as f:
                cutoffs = json.load(f)
            if sol_hash in cutoffs:
                print(cutoffs[sol_hash]["cutoff"], end="")
                return
        except Exception:
            pass

    # Fallback: solution commit date - 30 days
    if sol_hash:
        try:
            r = subprocess.run(
                ["git", "-C", repo_dir, "log", "-1", "--format=%ad", "--date=short", sol_hash],
                capture_output=True, text=True, timeout=5
            )
            if r.returncode == 0 and r.stdout.strip():
                sol_date = datetime.strptime(r.stdout.strip(), "%Y-%m-%d")
                cutoff = (sol_date - timedelta(days=30)).strftime("%Y-%m-%d")
                print(cutoff, end="")
                return
        except Exception:
            pass

    # Final fallback: HEAD date - 30 days
    try:
        r = subprocess.run(
            ["git", "-C", repo_dir, "log", "-1", "--format=%ad", "--date=short", "HEAD"],
            capture_output=True, text=True, timeout=5
        )
        if r.returncode == 0 and r.stdout.strip():
            head_date = datetime.strptime(r.stdout.strip(), "%Y-%m-%d")
            cutoff = (head_date - timedelta(days=30)).strftime("%Y-%m-%d")
            print(cutoff, end="")
            return
    except Exception:
        pass

if __name__ == "__main__":
    get_cutoff()
