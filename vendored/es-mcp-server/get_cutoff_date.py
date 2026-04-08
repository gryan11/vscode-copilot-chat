#!/usr/bin/env python3
"""Get the date cutoff and excluded PR for a task.

When called with no args: prints cutoff date (for GITHUB_SEARCH_CREATED_BEFORE)
When called with --exclude-pr: prints the solution PR number to exclude
"""
import json, os, re, subprocess, sys
from datetime import datetime, timedelta

def get_solution_hash():
    metadata_path = os.environ.get("METADATA_PATH", "")
    if not metadata_path or not os.path.exists(metadata_path):
        return ""
    try:
        with open(metadata_path) as f:
            meta = json.load(f)
        instance_id = meta.get("instance_id", "")
        parts = instance_id.split("-")
        for p in reversed(parts):
            if len(p) == 40 and all(c in "0123456789abcdef" for c in p):
                return p
        m = re.findall(r'[a-f0-9]{40}', instance_id)
        return m[0] if m else ""
    except Exception:
        return ""

def get_task_info(sol_hash):
    cutoff_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "task_cutoff_dates.json")
    if sol_hash and os.path.exists(cutoff_file):
        try:
            with open(cutoff_file) as f:
                cutoffs = json.load(f)
            if sol_hash in cutoffs:
                return cutoffs[sol_hash]
        except Exception:
            pass
    return None

def get_cutoff_fallback(sol_hash):
    repo_dir = os.environ.get("TESTBED_DIR", "/app")
    if sol_hash:
        try:
            r = subprocess.run(
                ["git", "-C", repo_dir, "log", "-1", "--format=%ad", "--date=short", sol_hash],
                capture_output=True, text=True, timeout=5
            )
            if r.returncode == 0 and r.stdout.strip():
                sol_date = datetime.strptime(r.stdout.strip(), "%Y-%m-%d")
                return (sol_date - timedelta(days=30)).strftime("%Y-%m-%d")
        except Exception:
            pass
    try:
        r = subprocess.run(
            ["git", "-C", repo_dir, "log", "-1", "--format=%ad", "--date=short", "HEAD"],
            capture_output=True, text=True, timeout=5
        )
        if r.returncode == 0 and r.stdout.strip():
            head_date = datetime.strptime(r.stdout.strip(), "%Y-%m-%d")
            return (head_date - timedelta(days=30)).strftime("%Y-%m-%d")
    except Exception:
        pass
    return ""

if __name__ == "__main__":
    sol_hash = get_solution_hash()
    info = get_task_info(sol_hash)

    if "--exclude-pr" in sys.argv:
        if info and info.get("pr_number"):
            print(info["pr_number"], end="")
    else:
        if info and info.get("cutoff"):
            print(info["cutoff"], end="")
        else:
            fallback = get_cutoff_fallback(sol_hash)
            if fallback:
                print(fallback, end="")
