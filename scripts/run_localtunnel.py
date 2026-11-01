import subprocess
import time
import sys
import re
import os

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

TARGET_URL = "https://cyclone-tracker.loca.lt"

def kill_proc_tree(pid):
    try:
        subprocess.run(["taskkill", "/t", "/f", "/pid", str(pid)], capture_output=True)
    except Exception:
        pass

def run():
    attempt = 1
    while True:
        print(f"\n=======================================================")
        print(f" [LocalTunnel] Attempt #{attempt}: Requesting {TARGET_URL}")
        print(f" Command: npx localtunnel --port 8000 --subdomain cyclone-tracker")
        print(f"=======================================================\n")
        sys.stdout.flush()

        try:
            proc = subprocess.Popen(
                ["npx.cmd", "localtunnel", "--port", "8000", "--subdomain", "cyclone-tracker"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
        except FileNotFoundError:
            # Fallback if npx.cmd is invoked as npx on some environments
            proc = subprocess.Popen(
                ["npx", "localtunnel", "--port", "8000", "--subdomain", "cyclone-tracker"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )

        detected_url = None
        start_time = time.time()

        while True:
            # Check timeout waiting for initial URL (15s)
            if time.time() - start_time > 15 and not detected_url:
                print("\n[LocalTunnel] Timed out waiting for URL from localtunnel server. Retrying...")
                kill_proc_tree(proc.pid)
                break

            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    # Process exited unexpectedly
                    print("\n[LocalTunnel] Process exited. Retrying...")
                    break
                time.sleep(0.1)
                continue

            print(line, end="", flush=True)

            m = re.search(r'https://[a-zA-Z0-9-]+\.loca\.lt/?', line)
            if m:
                detected_url = m.group(0).rstrip('/')
                break

        if detected_url and detected_url.rstrip('/') == TARGET_URL.rstrip('/'):
            print(f"\n" + "=" * 64)
            print(f" [LocalTunnel] SUCCESS! Desired URL acquired: {TARGET_URL}/")
            print(f" Dashboard is now live at: {TARGET_URL}/")
            print(f"=" * 64 + "\n")
            sys.stdout.flush()

            # Keep tunnel running and stream all request logs
            try:
                for line in iter(proc.stdout.readline, ''):
                    print(line, end='', flush=True)
                proc.wait()
                print("\n[LocalTunnel] Tunnel connection closed by server. Reconnecting in 3 seconds...")
                kill_proc_tree(proc.pid)
                time.sleep(3)
                attempt += 1
            except KeyboardInterrupt:
                print("\n[LocalTunnel] User requested stop. Terminating tunnel...")
                kill_proc_tree(proc.pid)
                break
        else:
            if detected_url:
                print(f"\n[LocalTunnel] Received: {detected_url} (Expected: {TARGET_URL})")
            print("[LocalTunnel] Sending Ctrl+C (terminating) and retrying in 3 seconds...\n")
            sys.stdout.flush()
            kill_proc_tree(proc.pid)
            time.sleep(3)
            attempt += 1

if __name__ == '__main__':
    try:
        run()
    except KeyboardInterrupt:
        print("\nExiting.")
