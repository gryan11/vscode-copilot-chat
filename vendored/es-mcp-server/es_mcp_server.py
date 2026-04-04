#!/usr/bin/env python3
"""
Elasticsearch MCP Server for SWE-bench Pro evaluation.

Provides issue/PR search tools over pre-built Elasticsearch indexes.
Runs as a stdio MCP server alongside the GitHub MCP server.

Tools provided:
- search_issues: Semantic + keyword search for issues and PRs
- get_issue: Get a specific issue/PR by number

Environment variables:
- ELASTICSEARCH_URL: ES URL (default: http://host.docker.internal:9200)
- ELASTICSEARCH_INDEX: Index name (auto-detected from TESTBED_DIR repo)
- REPO_OWNER: Repository owner (auto-detected)
- REPO_NAME: Repository name (auto-detected)
"""

import json
import os
import re
import subprocess
import sys
import urllib.request
import urllib.error
from typing import Any

ES_URL = os.environ.get("ELASTICSEARCH_URL", "http://172.17.0.1:9200")
ACA_URL = os.environ.get("ACA_URL", "https://metisrerank04.bluedesert-0c482a4e.westus3.azurecontainerapps.io")
ACA_KEY = os.environ.get("ACA_KEY", "")
ACA_MODEL = "metis"
ES_INDEX = os.environ.get("ELASTICSEARCH_INDEX", "")
REPO_OWNER = os.environ.get("REPO_OWNER", "")
REPO_NAME = os.environ.get("REPO_NAME", "")
EMBEDDING_DIM = 1024
DATE_CUTOFF = os.environ.get("GITHUB_SEARCH_CREATED_BEFORE", "")


def detect_repo_from_testbed():
    """Try to detect repo info from the testbed git config."""
    global ES_INDEX, REPO_OWNER, REPO_NAME
    testbed = os.environ.get("TESTBED_DIR", "/workspace")
    try:
        result = subprocess.run(
            ["git", "-C", testbed, "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            url = result.stdout.strip()
            # Parse github.com/owner/repo from URL
            m = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", url)
            if m:
                REPO_OWNER = m.group(1)
                REPO_NAME = m.group(2)
                slug = f"{REPO_OWNER}__{REPO_NAME}".lower()
                ES_INDEX = f"swebench_{slug}"
                log(f"Auto-detected repo: {REPO_OWNER}/{REPO_NAME}, index: {ES_INDEX}")
    except Exception as e:
        log(f"Could not detect repo: {e}")


def log(msg: str):
    print(f"[es-mcp] {msg}", file=sys.stderr)


def es_request(method: str, path: str, body: dict = None) -> dict:
    """Make a request to Elasticsearch."""
    url = f"{ES_URL}/{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.read().decode()[:500]}"}
    except Exception as e:
        return {"error": str(e)}


def get_query_embedding(text):
    """Get embedding for a query via the ACA endpoint."""
    if not ACA_KEY:
        return None
    text = text[:8000]
    data = json.dumps({"model": ACA_MODEL, "input": text}).encode()
    req = urllib.request.Request(
        f"{ACA_URL}/v1/embeddings",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {ACA_KEY}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            return result["data"][0]["embedding"]
    except Exception as e:
        log(f"Embedding request failed: {e}")
        return None


def search_issues(query: str, max_results: int = 10, item_type: str = "all",
                   state: str = "all") -> list[dict]:
    """Search issues/PRs using hybrid semantic (kNN) + keyword (BM25) search."""
    source_fields = ["number", "title", "body", "state", "is_pr", "created_at",
                     "closed_at", "author", "labels", "comments_count", "html_url"]

    # Build filter clauses for kNN and BM25
    filter_clauses = []
    if item_type == "issue":
        filter_clauses.append({"term": {"is_pr": False}})
    elif item_type == "pr":
        filter_clauses.append({"term": {"is_pr": True}})
    if state != "all":
        filter_clauses.append({"term": {"state": state}})
    if DATE_CUTOFF:
        filter_clauses.append({"range": {"created_at": {"lte": DATE_CUTOFF}}})

    # Try to get query embedding for semantic search
    query_vec = get_query_embedding(query)

    if query_vec:
        # Hybrid: kNN + BM25 via sub_searches (RRF)
        es_body = {
            "size": max_results,
            "_source": source_fields,
            "knn": {
                "field": "embedding",
                "query_vector": query_vec,
                "k": max_results * 2,
                "num_candidates": max(100, max_results * 5),
            },
            "query": {
                "bool": {
                    "must": [{
                        "multi_match": {
                            "query": query,
                            "fields": ["title^3", "body"],
                            "type": "best_fields",
                        }
                    }],
                    "filter": filter_clauses,
                }
            },
        }
        # Add filters to kNN too
        if filter_clauses:
            es_body["knn"]["filter"] = {"bool": {"must": filter_clauses}}
    else:
        # Fallback: BM25 only
        log("No embedding available, using BM25 only")
        es_body = {
            "size": max_results,
            "_source": source_fields,
            "query": {
                "bool": {
                    "must": [{
                        "multi_match": {
                            "query": query,
                            "fields": ["title^3", "body"],
                            "type": "best_fields",
                        }
                    }],
                    "filter": filter_clauses,
                }
            },
        }

    result = es_request("POST", f"{ES_INDEX}/_search", es_body)
    if "error" in result:
        return [{"error": result["error"]}]

    hits = result.get("hits", {}).get("hits", [])
    return [
        {**h["_source"], "score": h["_score"],
         "body": h["_source"].get("body", "")[:2000]}
        for h in hits
    ]


def get_issue(number: int) -> dict:
    """Get a specific issue/PR by number."""
    es_body = {
        "query": {"term": {"number": number}},
        "size": 1,
    }
    result = es_request("POST", f"{ES_INDEX}/_search", es_body)
    if "error" in result:
        return {"error": result["error"]}

    hits = result.get("hits", {}).get("hits", [])
    if not hits:
        return {"error": f"Issue #{number} not found"}

    return hits[0]["_source"]


# === MCP Protocol Implementation (stdio JSON-RPC) ===

TOOLS = [
    {
        "name": "search_issues",
        "description": f"Search GitHub issues and pull requests in the current repository's issue tracker. Returns matching issues/PRs with title, body, labels, and metadata. Use this to find relevant bugs, feature requests, and discussions.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query - keywords describing what you're looking for"
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results (default: 10, max: 20)",
                    "default": 10
                },
                "item_type": {
                    "type": "string",
                    "enum": ["all", "issue", "pr"],
                    "description": "Filter by type: 'issue', 'pr', or 'all'",
                    "default": "all"
                },
                "state": {
                    "type": "string",
                    "enum": ["all", "open", "closed"],
                    "description": "Filter by state",
                    "default": "all"
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_issue",
        "description": f"Get the full details of a specific GitHub issue or pull request by its number.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "number": {
                    "type": "integer",
                    "description": "The issue or PR number"
                },
            },
            "required": ["number"],
        },
    },
]


def handle_request(req: dict) -> dict:
    """Handle a JSON-RPC request."""
    method = req.get("method", "")
    params = req.get("params", {})
    req_id = req.get("id")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {
                    "name": "elasticsearch-issues",
                    "version": "1.0.0",
                },
            },
        }

    elif method == "notifications/initialized":
        return None  # Notification, no response

    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": TOOLS},
        }

    elif method == "tools/call":
        tool_name = params.get("name", "")
        args = params.get("arguments", {})

        try:
            if tool_name == "search_issues":
                results = search_issues(
                    query=args["query"],
                    max_results=min(args.get("max_results", 10), 20),
                    item_type=args.get("item_type", "all"),
                    state=args.get("state", "all"),
                )
                text = json.dumps(results, indent=2)
            elif tool_name == "get_issue":
                result = get_issue(args["number"])
                text = json.dumps(result, indent=2)
            else:
                text = json.dumps({"error": f"Unknown tool: {tool_name}"})

            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": text}],
                    "isError": False,
                },
            }
        except Exception as e:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps({"error": str(e)})}],
                    "isError": True,
                },
            }

    elif method == "ping":
        return {"jsonrpc": "2.0", "id": req_id, "result": {}}

    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }


def main():
    detect_repo_from_testbed()
    log(f"Starting ES MCP server (index={ES_INDEX}, es={ES_URL}, cutoff={DATE_CUTOFF or 'none'})")

    # Read JSON-RPC messages from stdin, write to stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        response = handle_request(req)
        if response is not None:
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
