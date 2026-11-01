#!/usr/bin/env python3
"""
scripts/auto_push_github.py
Background daemon that periodically checks IMD Mausam for new cyclone bulletins/advisories,
updates data/latest_cyclone.json, data/latest_cyclone_data.js, index.html, and latest_advisory.html,
and automatically commits and pushes to GitHub so your office network always sees the latest updates!
"""

import os
import sys
import time
import subprocess
import json

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INTERVAL_SECONDS = 900  # Check every 15 minutes

def find_git_cmd():
    # 1. Check if git is in PATH
    try:
        res = subprocess.run(["where", "git"], capture_output=True, text=True)
        if res.returncode == 0:
            lines = res.stdout.strip().splitlines()
            if lines:
                return lines[0].strip()
    except Exception:
        pass

    # 2. Check GitHub Desktop location
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    gh_dir = os.path.join(local_app_data, "GitHubDesktop")
    if os.path.exists(gh_dir):
        for entry in os.listdir(gh_dir):
            if entry.startswith("app-"):
                candidate = os.path.join(gh_dir, entry, "resources", "app", "git", "cmd", "git.exe")
                if os.path.exists(candidate):
                    return candidate

    # 3. Standard Git for Windows
    std_git = r"C:\Program Files\Git\cmd\git.exe"
    if os.path.exists(std_git):
        return std_git

    return "git"

def push_to_github(git_cmd, storm_info):
    try:
        print(f"[{time.strftime('%X')}] Committing and pushing to GitHub...")
        files_to_stage = [
            "data/latest_cyclone.json",
            "data/latest_cyclone_data.js",
            "index.html",
            "latest_advisory.html",
            "arnab_cyclone_openinframap.html",
            "app.js",
            "scripts/fetch_imd.py",
            ".github/workflows/update_track.yml"
        ]
        subprocess.run([git_cmd, "add"] + files_to_stage, cwd=PROJECT_DIR, check=True)

        # Check if there are staged changes
        diff_res = subprocess.run([git_cmd, "diff", "--staged", "--quiet"], cwd=PROJECT_DIR)
        if diff_res.returncode == 0:
            print(f"[{time.strftime('%X')}] No new changes to push (already up to date on GitHub).")
            return

        commit_msg = f"Auto-update IMD Advisory: {storm_info} [{time.strftime('%d-%b-%Y %H:%M')}]"
        subprocess.run([git_cmd, "commit", "-m", commit_msg], cwd=PROJECT_DIR, check=True)
        push_res = subprocess.run([git_cmd, "push", "origin", "main"], cwd=PROJECT_DIR, capture_output=True, text=True)
        if push_res.returncode == 0:
            print(f"[{time.strftime('%X')}] Successfully pushed to GitHub!")
            print(f"[{time.strftime('%X')}] Live on office network: https://ajithganji.github.io/cyclone-tracking/")
        else:
            print(f"[{time.strftime('%X')}] Git push output: {push_res.stderr or push_res.stdout}")
    except Exception as e:
        print(f"[{time.strftime('%X')}] Error during git push: {e}")

def run_loop():
    print("=" * 68)
    print("🌀 AUTOMATIC CYCLONE ADVISORY UPDATER & GITHUB PUSHER")
    print("=" * 68)
    print(f"Project Folder: {PROJECT_DIR}")
    print(f"Checking IMD every {INTERVAL_SECONDS // 60} minutes...")
    print(f"Live GitHub URL: https://ajithganji.github.io/cyclone-tracking/")
    print("=" * 68)

    git_cmd = find_git_cmd()
    print(f"Using Git: {git_cmd}\n")

    scripts_dir = os.path.join(PROJECT_DIR, "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    import fetch_imd

    while True:
        try:
            print(f"\n[{time.strftime('%X')}] Scraping IMD Mausam for latest advisory...")
            fetch_imd.main()

            data_file = os.path.join(PROJECT_DIR, "data", "latest_cyclone.json")
            storm_info = "Latest Advisory"
            if os.path.exists(data_file):
                with open(data_file, 'r', encoding='utf-8') as f:
                    d = json.load(f)
                    storm_info = f"{d.get('name', 'Latest Advisory')} ({d.get('bulletinNo', '')})"

            push_to_github(git_cmd, storm_info)
        except Exception as err:
            print(f"[{time.strftime('%X')}] Notice: {err}")

        print(f"[{time.strftime('%X')}] Next automatic check in {INTERVAL_SECONDS // 60} minutes. Press Ctrl+C to stop.")
        time.sleep(INTERVAL_SECONDS)

if __name__ == '__main__':
    run_loop()

