# Enabling Remote Data Fetching in Codex-CLI

This note summarises the discussion on how to let a **locally-run** Codex-CLI
session download data from the internet (for example GitHub files or commit
patches) and how to expose that capability to the language-model assistant.

## 1. Understand the Two Sandboxes

| Environment | Network Access | Can be changed by editing the repo? |
|-------------|---------------|-------------------------------------|
| **Playground / hosted** (where these chats are executed) | **Blocked** by the platform | **No** – outbound traffic is disabled at infrastructure level. |
| **Your local workstation** | Allowed unless Codex spawns the child process inside the OS sandbox (Seatbelt on macOS, Landlock on Linux). | **Yes** – you decide whether to use a sandbox. |

## 2. Disable the OS Sandbox Locally

Running Codex with either of the switches below means *all* commands executed
by the assistant gain full network and file-system access:

```bash
# Option A – environment variable
CODEX_UNSAFE_ALLOW_NO_SANDBOX=1 codex "<prompt>"

# Option B – CLI flag (sets the env-var under the hood)
codex --dangerously-auto-approve-everything "<prompt>"
```

The change that introduced this behaviour is in
`codex-cli/src/utils/agent/handle-exec-command.ts`: when the env-var is set the
function `getSandbox()` immediately returns `SandboxType.NONE` and skips the
Seatbelt/Landlock branches.

## 3. Fetching Data via Standard Tools

With the sandbox off, any assistant-generated command such as:

```json
{ "cmd": ["curl", "https://example.com"] }
```

works out-of-the-box.  You can whitelist `curl`/`wget` in the approval logic or
run in `--full-auto` mode to avoid repeated prompts.

## 4. Adding a First-Class `fetch_url` Tool (Optional)

If you prefer a dedicated helper that returns the body directly to the
assistant (without calling an external program):

1. **Create a utility** `src/utils/fetch-url.ts`:

   ```ts
   import fetch from "node-fetch";

   export async function fetchUrl(url: string): Promise<string> {
     const res = await fetch(url);
     if (!res.ok) {
       throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
     }
     return await res.text();
   }
   ```

2. **Short-circuit** `handle-exec-command.ts` before sandboxing:

   ```ts
   if (command[0] === "fetch_url") {
     const body = await fetchUrl(command[1]);
     return { outputText: body.slice(0, 16 * 1024), metadata: { ok: true } };
   }
   ```

3. **Document the tool** in your system prompt so the model knows it exists:

   > You can download any public URL with `{ "cmd": ["fetch_url", "<url>"] }`.

## 5. GitHub URL Cheatsheet

* **Raw file:**
  `https://raw.githubusercontent.com/{owner}/{repo}/{branch_or_sha}/{path}`
* **Commit diff:**
  `https://github.com/{owner}/{repo}/commit/{sha}.patch`
* **REST API:**
  `https://api.github.com/repos/{owner}/{repo}/commits/{sha}`

Example assistant command to fetch a commit patch:

```json
{ "cmd": [
    "fetch_url",
    "https://github.com/henryperkins/codex/commit/04f4c115fb69afa8.patch"
  ] }
```

## 6. Security Reminder

Disabling the sandbox removes the defence-in-depth layer that normally
restricts file-system writes and network access. **Only use the
`--dangerously-auto-approve-everything` flag in trusted environments** such as
your local machine or an already locked-down CI container.
