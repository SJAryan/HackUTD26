# HackUTD | Give this file to your coding agent

All four teammates can use this file on their own laptop. One agent can install the skills for both Claude Code and Codex. `SETUP.md` works by itself.

## Copy this prompt at kickoff

After hacking officially opens, one teammate creates the team repository and shares the clone URL. Open your own clone at its root, give this file to your local Claude Code or Codex session, and paste the prompt.

> Read SETUP.md and install its seven pinned skills for the local coding clients I use. Hacking has started and I am in the team clone. Extract the Python installer between the installer markers to a temporary file outside the repo. Run it with --scope project --clients auto, then repeat with --check. Use the existing repo only. Preserve existing files and settings. Skip the optional board and browser runtime. Report the clients, paths, skill names and check result. Walk me through the discovery check in each client I use. Stop after setup.

**Optional personal setup before kickoff.** Only use this route if the organizers allow preparing personal tools. Save this handout in Downloads, open a local agent in a neutral folder, and paste the prompt below. These skills will be available to that client in other projects on your laptop. If your team is waiting for the start, use the kickoff prompt above.

> Read SETUP.md. Personal tool preparation is allowed. Install its seven pinned skills in my personal skill directories with --scope personal --clients auto. Use the embedded Python installer from a temporary file outside any repository, then repeat with --check. Leave all repositories, product files and GitHub alone. Report what passed and show me the discovery check.

`auto` selects the local `claude` and/or `codex` executables found on PATH. If you use a client through an IDE and it is missing from the result, tell the agent “use `--clients claude`” or “use `--clients both`.” The standard install writes only `skills/` and the supporting `references/` under the selected client directories (`.claude/` or `.agents/`). Use the local CLI or its terminal for the checks. A hosted chat runs in a different environment.

Everyone can use the seven defaults. After kickoff the frontend owner can opt into **Impeccable** to review a working demo screen, **Taste** to design a public opening page, or both. For a dashboard or form-based demo, prioritize Impeccable on the screen the judges will actually see.

## What the agent installs

| Skill | When your team should call it | Evidence to ask for |
|---|---|---|
| `karpathy-guidelines` · Multica, required | Any implementation or review. Give the agent one behavior to change and the files its owner controls. | One assumption, a focused diff, and a check someone else can reproduce. |
| `idea-refine` · Addy Osmani | Once the organizers reveal the prompts. Timebox the comparison to 15 minutes. | Two or three options ranked against the real rubric, available data or API, time to first working result, and what a judge can try. |
| `api-and-interface-design` · Addy Osmani | Before frontend, core logic and sponsor integration split up. | One actual request, success response and error example that both sides agree to. A function signature works for a local app. |
| `frontend-design` · Anthropic | The owner of a web interface designs the screen the audience will watch. | A clear starting action and a legible result at the actual recording size and at presentation distance. |
| `webapp-testing` · Anthropic | The demo owner exercises a local web app in Chromium and collects evidence. | A real click through the core flow, an assertion on the result, a reset, and a screenshot or console log if it fails. |
| `debugging-and-error-recovery` · Addy Osmani | A merge, sponsor call or demo run fails. Give it the last known good input. | A reproducible failure, the smallest fix, and a successful rerun of the same steps. |
| `code-review-and-quality` · Addy Osmani | An extra Codex or Claude session reviews a specific commit before it reaches the demo machine. | Findings tied to files and a failing case, or the exact checks it ran. The human owner chooses the fix. |
| **Optional** `impeccable` · Paul Bakaus | Once a judge can use the main interaction, review the exact input and result screen. | The top two things a judge might miss, a targeted fix and a second look at recording and presentation size. |
| **Optional** `design-taste-frontend` · Taste | The idea needs a public opening page that introduces the product. | A clear visual hierarchy and one obvious action that opens the real demo. |

For a hardware, mobile or CLI project, use the native device or terminal to test the judge's action. The two web skills can sit idle. Start with one relevant skill per task.

## Impeccable for the working demo

**One prompt to install Impeccable after kickoff**

> Read SETUP.md. Hacking has started and I am in the team clone. Extract the embedded installer to a temporary file and run it with --scope project --clients auto --with-impeccable. Repeat with the same flags plus --check. From the repo root, run the installed Impeccable launcher with engine-probe, allowing its first-run engine download if needed. Report the client names, the engine version or error, and the skill discovery check for each client. Stop after setup.

The option installs Impeccable 4.8.0 into the selected clients with its matching references and notices. It enables zero automatic edit hooks. The launcher is `.claude/skills/impeccable/scripts/impeccable` for Claude and `.agents/skills/impeccable/scripts/impeccable` for Codex. Its first run may download the native engine into the user's cache. Try it while the laptop has internet. The `--check` step itself works offline. To install both design add-ons in one go, include `--with-impeccable --with-taste` on both the install and check commands. Expect eight skills with either add-on and nine with both. [Pinned release and installation notes](https://github.com/pbakaus/impeccable/tree/414603bf14c7a344edb466bb1f85690c77ce8b7d)

**How to use it before the two demos**

1. In Claude Code, type `/impeccable critique`. In Codex, type `$impeccable critique`. Give it the actual route, the judge's input and the expected result. Try this prompt: “Review the result screen a judge sees after our main action. What would they notice first? Could they tell what changed with the audio muted? Rank the top two fixes. Keep product-code edits for a separate task.”
2. If something is hard to use, run `/impeccable audit` on that interaction for keyboard focus, contrast or a cramped layout. Send specific findings to the frontend owner. Use `/impeccable polish` on the chosen element if it needs a final pass. Codex uses the same subcommands after `$impeccable`.
3. Have a teammate replay the same input. Watch a short recording at Devpost playback size, then have someone identify the result from across the judging table. Re-record or rehearse after the change. If the team wants a shared product brief, one owner can run `/impeccable init` after choosing the track to write `PRODUCT.md`. Keep the review on the chosen screen and leave live-variant editing and automatic hooks off for this workflow. [Critique](https://impeccable.style/docs/critique/) · [Audit](https://impeccable.style/docs/audit/) · [Polish](https://impeccable.style/docs/polish/)

## Taste for the frontend owner

Taste 2.5 (`design-taste-frontend`) is optional for the teammate building a public-facing web page. Use it once the real demo interaction works. It can give the opening screen a clear visual hierarchy, draw attention to the actual product and check its layout in a browser at four widths. For an app that opens directly into a dashboard, form or results screen, start with `frontend-design` on that screen and use `webapp-testing` on the interaction. A separate landing page earns its time when it helps the judge understand or start the demo. [Taste at the pinned revision](https://github.com/Leonxlnx/taste-skill/tree/9b4bf937a1f69348126959c15d2f99a73e65699b/skills/taste-skill)

**One prompt to install Taste after kickoff**

> Read SETUP.md. Hacking has started. I own the frontend and I am at the root of my team clone. Run the embedded installer with --scope project --clients auto --with-taste, then repeat with --check. Confirm design-taste-frontend is available in each local client I use. Check for Node 22+ and Chrome, Edge or Chromium, and tell me if anything is missing. Stop after setup. I will give you the page brief separately.

The option fetches one exact Git commit into a temporary folder and copies the complete skill, scripts, assets and license into each selected client's skill directory. An existing base install can be upgraded by running that same prompt. The repeated `--check` is offline. The pinned skill is about **36 MB per client** before filesystem overhead. One frontend checkout is sufficient. Browser checks need Node 22+ and Chrome, Edge or Chromium. The supplied templates, photos and icons are third-party material. Check the event's reuse and attribution rules at kickoff before copying any into the entry. You can also ask for a critique of a screenshot of your own UI if that fits the rules. [Upstream requirements and credits](https://github.com/Leonxlnx/taste-skill/blob/9b4bf937a1f69348126959c15d2f99a73e65699b/README.md)

**First design task**

> Use design-taste-frontend on the public opening screen. In one laptop viewport, show who this helps, a real example result from our tested build, and one obvious action that starts the demo. Use our existing design system and keep the result readable in the Devpost recording and from across the judging table. Keep scope to my frontend files. Show me a before/after at the presentation size, then use webapp-testing to verify the button reaches the working flow.

In Claude Code, select `/design-taste-frontend`. In Codex CLI, select `$design-taste-frontend`. For a quick diagnostic, run `node scripts/start.mjs deal --page software` **from the installed skill folder**, passing `--history` with a temporary path so the working copies stay clean. For the real page, use `node <skill-folder>/scripts/consistency.mjs <local-url> --page software` from the project root, adjusting the page kind to the brief. Review its results, then test the actual user action separately.

## How to tell the install worked

1. **Check the files.** The installer verifies the seven default skills file by file and checks each selected add-on's complete file inventory. Re-running it with the same options and `--check` verifies local files offline. A different existing file or a symlink at a destination stops the install and reports the path.
2. **Check the actual client.** In a new local Claude Code session, type `/karpathy-guidelines` followed by “Explain how you would verify a hypothetical button fix. Read only.” In Codex CLI, open `/skills` or type `$karpathy-guidelines` with the same request. Match the seven defaults and whichever add-ons you chose against the table. If a skill is missing, check the selected client, its active folder, and any same-named personal or project copy. On a laptop with both clients, verify both. [Claude Code skills](https://code.claude.com/docs/en/skills) · [OpenAI Codex skills](https://learn.chatgpt.com/docs/build-skills)
3. **Use the result.** File verification and client discovery are separate checks. Mark each client as verified, missing, or awaiting a restart. The first real behavior test at kickoff is a teammate reproducing a result from a different clone.

## At kickoff, one maintainer and four teammates

- The maintainer creates the repo **after the official start**, copies these three Markdown files to its root, and records the actual rubric, AI and attribution rules, deadline, video limit and live slot in `AGENTS.md`. Review any existing instructions before merging. Keep event-specific product work for the competition window.
- For a single shared install, the maintainer uses `--scope project --clients both`, reviews the files, and commits the intended skill files and notices under the team's Git policy. Teammates pull and run the same kickoff prompt. Matching files pass locally even without network access. Personal-only users can keep that scope and verify their copy if the team chooses personal installs.
- Merge these five entries into the repo's `.gitignore`, **one per line in this order**: `.env`, `.env.*`, `!.env.example`, `/.tooling/`, `/.board/`. Run `git check-ignore apps/api/.env apps/web/.env.local` and confirm both paths are printed. Confirm `git check-ignore apps/api/.env.example` prints nothing. Keep real credentials local.
- Assign four humans to interface, core behavior, external integration, and integration/demo. Agree on paths and one shared contract. Two simultaneous writers use separate clones and branches. Give extra sessions a committed diff for review or a clean clone for a rehearsal.

## Two demos, two finish lines

Use the same verified build and example input to tell the same story. Assign a named owner and a second person to check each deliverable. Enter the **actual** event limits before scripting either. The times below are practice targets only.

| | Devpost submission video | Live presentation and demo |
|---|---|---|
| Audience | A judge watching later, without your team there to explain. | People in front of you who can interrupt or ask to see it again. |
| Build it around | Show the user's problem in one sentence, record the main action, pause on the visible result, then show how the important integration contributed. Use readable zoom, a clear voiceover and captions when possible. | Assign a speaker and a driver. Open on the user's problem, demonstrate a real interaction, let a judge change an input if practical, then explain one technical decision and take questions. |
| Practice | For a 90-second rehearsal, try 10 seconds for the problem, 55 for the working product, 20 for how it works or why the result matters, and 5 for the close. Scale to the published cap. | Rehearse a 60–90 second core sequence that fits inside the published live slot, leaving room for Q&A. Practice restarting from the opening screen and switching to a labeled local recording if Wi-Fi fails. |
| Done when | Another teammate watches the final export with audio, uploads or links it using an event-approved host, checks playback while signed out, and verifies the link on the **HackUTD event submission** plus the submission confirmation. | Someone other than the builder runs the demo twice on the presentation laptop at the expected display size. They can reset quickly, answer “What did you build?” and identify which part ran live. |

**Prompt for the video owner**

> Use the released Devpost rubric, video cap, verified commit, and our tested input/output. Give me a timed shot list with four columns: seconds, what is on screen, exact narration, and which rubric item the shot proves. Tell me what to record and what still needs evidence. Leave room to show the result clearly. I will record and submit it.

**Prompt for the live team**

> Use our verified build and the official live slot. Write a speaker/driver run sheet, the exact initial state, one judge-controlled input, the reset steps and a one-line introduction for our recorded fallback. Give us five likely judge questions with answers grounded in what we actually built. Leave time for questions. Identify anything we have to test on the presentation laptop.

Devpost recommends a narrated screencast and explains how to put a supported video URL on the actual hackathon entry. MLH's example judging format explicitly budgets time for questions. Follow HackUTD's released requirements for lengths, hosts and submission fields. [Devpost video guidance](https://help.devpost.com/article/84-video-making-best-practices) · [Devpost submission video](https://help.devpost.com/article/85-uploading-a-demo-video) · [MLH judging guide](https://github.com/MLH/mlh-hackathon-organizer-guide/blob/master/general-information/judging-and-submissions/judging-plan.md) · [HackUTD](https://zeroday.hackutd.co/)

## Optional tools after kickoff

**Browser runtime, for the web demo tester.** Installing `webapp-testing` adds instructions, examples and a server helper. A real browser run also needs Python Playwright and Chromium on the tester's laptop. Prefer the project's existing working browser tests. If the team chooses the supplied Python workflow, one tester can create a project-local environment and run the following from the repo root on macOS, Linux or WSL. Use a fresh directory or an already reviewed environment. Then test the real user flow and record the result. [Playwright Python](https://playwright.dev/python/docs/library) · [Pinned example runtime](https://pypi.org/project/playwright/1.62.0/)

```bash
python3 -m venv .tooling/demo-qa
.tooling/demo-qa/bin/python -m pip install 'playwright==1.62.0'
.tooling/demo-qa/bin/python -m playwright install chromium
```

**GitHub message board.** Team chat and pull requests are sufficient to start. If the team wants the issue-based board, the maintainer can rerun the installer with `--scope project --clients both --with-board` and agree on one real issue and the allowed posting scope. This copies a reviewed wrapper and a guard. It makes zero GitHub posts. Put only nonsecret routing values in a reviewed `.board.env`: `export BOARD_REPO='owner/repo'`, `export BOARD_ISSUE='actual-number'`, and `export BOARD_WAIT='off'`. Source it in the launching terminal. Check `gh api user --jq .login`, `gh issue view "$BOARD_ISSUE" --repo "$BOARD_REPO"`, and `tools/board read -n 10`. Use `tools/board` for all calls. The guard requires an explicit repo and a positive issue number before invoking upstream. Test a handoff and reply using two distinct accounts. Same-login Claude and Codex sessions need a human handoff or `tools/board read -n 20` because `unread` filters that account's posts. Keep one cursor reader per clone, check at task boundaries, and use team chat while blocked. [Pinned board source](https://github.com/azizu06/hackathon-agent-board/blob/91a9f0120c05c0efaf7b0e52bc96c28de8b4486c/tools/board)

**Tools considered.** Ponytail overlaps the simplicity rule in Karpathy. The full Addy pack adds workflows beyond this weekend's four roles. Graphify is worth revisiting if searching a large codebase starts slowing the team down. OmniRoute changes model routing and brings separate provider and cost decisions. Keep those, hooks and background agents outside the default install. Remotion is an option if the team already uses it for video editing. An actual screen capture gives you usable Devpost footage as soon as the product works. [Ponytail](https://github.com/DietrichGebert/ponytail) · [Graphify](https://github.com/Graphify-Labs/graphify) · [OmniRoute](https://github.com/cheaper-inference/OmniRoute) · [Remotion skills](https://www.remotion.dev/docs/ai/skills)

## Sources and selection

The choices above are based on skill contents and the work this team has to finish. SkillsBench found a 4.5 percentage-point mean improvement on its software-engineering tasks and substantial differences across tasks. That is evidence to try specific workflows and measure their results. Hackathon judging outcomes were outside the benchmark. [SkillsBench paper](https://www.skillsbench.ai/skillsbench.pdf)

- Multica's required skill scopes changes and asks for verifiable outcomes. The installer preserves its original frontmatter and body. [Karpathy guidelines at the installed revision](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/skills/karpathy-guidelines/SKILL.md)
- Addy Osmani's four selected workflows handle idea selection, interface agreements, debugging and review. The installer includes the ideation examples and helper, the review skill's two shared references at their expected paths, and the upstream MIT notice. [Addy skills at the installed revision](https://github.com/addyosmani/agent-skills/tree/301b02b12bff98e4688e6984af6556802322bbde/skills)
- Anthropic's design skill grounds visuals in the problem. Its web testing skill uses Python Playwright for real browser interactions and includes server and logging helpers. The installer keeps both skill folders and license files. [Frontend design](https://github.com/anthropics/skills/tree/ca45fc496a3436251f191354091d557da31c15b5/skills/frontend-design) · [Web app testing](https://github.com/anthropics/skills/tree/ca45fc496a3436251f191354091d557da31c15b5/skills/webapp-testing)

## Installer for the agent

Use Python 3.8+ on macOS, Linux or WSL. Extract only the Python code block delimited below, using a new temporary file outside the repository. Run it with the options in the chosen prompt and remove the temporary file afterward. In project mode keep the working directory at the team repo root. The installer copies helpers and examples as files. The core uses SHA-256 per file. Each optional design skill uses a pinned Git checkout and verifies an inventory of every filename and Git blob ID against its fixed SHA-256 digest. Impeccable uses a separate inventory for each client. Existing copies can be verified locally.

<!-- INSTALLER START -->
```python
"""Install just the HackUTD handout's pinned files. Python 3.8+."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.request import urlopen


REVISIONS = {'kar': ('multica-ai/andrej-karpathy-skills', '2c606141936f1eeef17fa3043a72095b4765b9c2'),
 'addy': ('addyosmani/agent-skills', '301b02b12bff98e4688e6984af6556802322bbde'),
 'anth': ('anthropics/skills', 'ca45fc496a3436251f191354091d557da31c15b5'),
 'board': ('azizu06/hackathon-agent-board', '91a9f0120c05c0efaf7b0e52bc96c28de8b4486c')}

# Upstream paths and SHA-256 of the reviewed bytes. Folders retain their layout.
FILES = [
    ('kar', 'skills/karpathy-guidelines/SKILL.md', '6e22cc54cb02a5e98ae42d06d9d7292db0c1b43894831b32879beb0166b2aea7'),
    ('addy', 'LICENSE', '6f202f8bd568cd730dbb2b0d1f8e243bc74c2fa1f64dbce9b2c7ea08bd5c9fd7'),
    ('addy', 'references/performance-checklist.md', 'ce946457d4a502846e781a2747cf6af50bcc79b1957a66dc024f50557e8982e1'),
    ('addy', 'references/security-checklist.md', '84ed77cbba419c95390618f857eca2fadfeec12f2e5d39af4cc1833b94d82a39'),
    ('addy', 'skills/api-and-interface-design/SKILL.md', 'cc5e2166c484b2c297e8253f56e7525e5031f81d66101ca4e760ef378ea6bad0'),
    ('addy', 'skills/code-review-and-quality/SKILL.md', 'a47551daf26e3cc5670f5286f9e4850c2fc662d5ba08b86eee895254f3851797'),
    ('addy', 'skills/debugging-and-error-recovery/SKILL.md', '01cff31fbd8796b444225f8a8386219792c25cebb5d4d76df664afd1d13ed610'),
    ('addy', 'skills/idea-refine/SKILL.md', 'c226c1cd369bef2671073f5fd1f4108731691f725ef28f8c8c01d247c214d0c3'),
    ('addy', 'skills/idea-refine/examples.md', '563204bfbf2f80a444151695205af4cb759e722b3d1e5460e08f278a69c89ba1'),
    ('addy', 'skills/idea-refine/frameworks.md', '161ebc18fdf2d996bc62a87a2d747cf1bf53548354f8925de25c732c27f00309'),
    ('addy', 'skills/idea-refine/refinement-criteria.md', '1ca2973a4d01b5cb37ab7ddb2eff77fa4e792634a33d0ce44961c068fc88d51a'),
    ('addy', 'skills/idea-refine/scripts/idea-refine.sh', 'f02a52408a4218047c032d221483abfbb48d11f090bb4915965c7419bf2e0e47'),
    ('anth', 'skills/frontend-design/LICENSE.txt', '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594'),
    ('anth', 'skills/frontend-design/SKILL.md', 'd91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3'),
    ('anth', 'skills/webapp-testing/LICENSE.txt', 'bc6b3af2f331cbc7fb0da1344efb2cbe5877a31498b4d70dbc7000f3405a1362'),
    ('anth', 'skills/webapp-testing/SKILL.md', '51b7349e77ec63b7744a6f63647e7566a0b4d2e301121cc10e8c2113af6556a2'),
    ('anth', 'skills/webapp-testing/examples/console_logging.py', 'ea46877289acb82da7e7ce59d0bc37c8977cd57e2a006d0c88d7a1c625bf95da'),
    ('anth', 'skills/webapp-testing/examples/element_discovery.py', 'd63c89604a22f8845d724e95dda45db49b1bf57c25ce0a83afbb7b8da3d402f0'),
    ('anth', 'skills/webapp-testing/examples/static_html_automation.py', '9d533aafb875ee3ab8b8ebf8f5b9003ac8d999da3d09b285cce252e623140064'),
    ('anth', 'skills/webapp-testing/scripts/with_server.py', 'b0dcf4918935b795f4eda9821579b9902119235ff4447f687a30286e7d0925fd'),
    ('board', 'tools/board', 'faef4c31d656d7bb18744df5ade1d9cf90900f5269f8e912a687399ab1a5bce9'),
]

# SHA-256 of sorted relative names and Git blob IDs for the full skill plus its MIT license.
TASTE_URL = "https://github.com/Leonxlnx/taste-skill.git"
TASTE_REV = "9b4bf937a1f69348126959c15d2f99a73e65699b"
TASTE_SIGNATURE = "b9c63179a7375b09e3c255bb8e3f8e13be927e005b89faf9a55f385e05eba8de"
TASTE_NAME = "design-taste-frontend"

# Paths are upstream release payloads. Impeccable's two editions have different references.
ADDONS = {
    TASTE_NAME: {
        "url": TASTE_URL, "revision": TASTE_REV, "notices": ("LICENSE",),
        "clients": dict.fromkeys(("claude", "codex"), ("skills/taste-skill", TASTE_SIGNATURE)),
    },
    "impeccable": {
        "url": "https://github.com/pbakaus/impeccable.git",
        "revision": "414603bf14c7a344edb466bb1f85690c77ce8b7d",
        "notices": ("LICENSE", "NOTICE.md"),
        "clients": {
            "claude": (".claude/skills/impeccable", "6ec19db43e0a9ec677de32b3ba8c9edb3f7d4df08413b43e1808914361d92f8e"),
            "codex": (".agents/skills/impeccable", "470448ddf2f6fde4c63c9ff62f5cf2ebe68d985640860cf88c4fc071551a6186"),
        },
    },
}

BOARD_LAUNCHER = b'''#!/usr/bin/env bash
set -eu
: "${BOARD_REPO:?Load the reviewed .board.env first}"
: "${BOARD_ISSUE:?Load the reviewed .board.env first}"
[[ "$BOARD_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Invalid BOARD_REPO" >&2; exit 2; }
[[ "$BOARD_ISSUE" =~ ^[1-9][0-9]*$ ]] || { echo "BOARD_ISSUE must be a positive issue number" >&2; exit 2; }
root="$(git rev-parse --show-toplevel)"
exec bash "$root/tools/board-upstream" "$@"
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def select_clients(value):
    if value == "auto":
        clients = [name for name in ("claude", "codex") if shutil.which(name)]
        if not clients:
            raise ValueError("No CLI found on PATH. Choose --clients claude, codex, or both for a local client.")
        return clients
    return ["claude", "codex"] if value == "both" else [value]


def install_root(scope):
    if scope == "personal":
        return Path.home().resolve()
    cwd = Path.cwd().resolve()
    result = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if result.returncode or Path(result.stdout.strip()).resolve() != cwd:
        raise ValueError("Project mode needs the root of the existing team clone. This installer never creates one.")
    return cwd


def build_plan(clients, with_board):
    plan = []
    for client in clients:
        base = Path(".claude" if client == "claude" else ".agents")
        for provider, path, checksum in FILES:
            if provider == "board":
                continue
            target = base / path
            if provider == "addy" and path == "LICENSE":
                target = base / "references/addy-agent-skills-LICENSE.txt"
            plan.append((target, (provider, path), checksum))
    if with_board:
        provider, path, checksum = next(row for row in FILES if row[0] == "board")
        plan.append((Path("tools/board-upstream"), (provider, path), checksum))
        plan.append((Path("tools/board"), ("local", "launcher"), digest(BOARD_LAUNCHER)))
    return plan


def safe_target(root, relative):
    target = root
    for part in relative.parts:
        target = target / part
        if target.is_symlink():
            raise ValueError(f"Preserving symlink at {target}. Choose another scope or review the existing setup.")
        if target.exists() and target != root / relative and not target.is_dir():
            raise ValueError(f"Expected a directory at {target}. No replacement was made.")
    return target


def installed(root, relative, checksum):
    target = safe_target(root, relative)
    if not target.exists():
        return False
    if not target.is_file() or digest(target.read_bytes()) != checksum:
        raise ValueError(f"Existing content differs at {target}. Preserve it and review the conflict.")
    if relative == Path("tools/board") and not os.access(target, os.X_OK):
        raise ValueError(f"The existing board launcher needs execute permission: {target}")
    return True


def verify_addon(folder, name, signature):
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError(f"Expected a regular {name} skill directory at {folder}.")
    inventory = hashlib.sha256()
    for path in sorted(folder.rglob("*"), key=lambda p: p.relative_to(folder).as_posix()):
        if path.is_symlink():
            raise ValueError(f"Preserving symlink at {path}.")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError(f"Unexpected special file at {path}.")
        body = path.read_bytes()
        header = f"blob {len(body)}\0".encode("ascii")
        blob = hashlib.sha1(header + body).digest()
        inventory.update(path.relative_to(folder).as_posix().encode("utf-8") + b"\0" + blob + b"\n")
    if inventory.hexdigest() != signature:
        raise ValueError(f"{name} contents at {folder} differ from the pin. Preserve this folder and review the difference.")
    if name == "impeccable" and not os.access(folder / "scripts/impeccable", os.X_OK):
        raise ValueError(f"The Impeccable launcher needs execute permission: {folder / 'scripts/impeccable'}")


def install_addon(name, targets):
    addon = ADDONS[name]
    sources = sorted({source for _, source, _ in targets})
    with tempfile.TemporaryDirectory() as temp:
        checkout = Path(temp)
        git = ["git", "-c", "core.autocrlf=false", "-c", "core.hooksPath=/dev/null", "-C", temp]
        steps = [
            ["init", "--quiet", "--template="],
            ["fetch", "--quiet", "--depth=1", "--no-tags", addon["url"], addon["revision"]],
            ["checkout", "--quiet", addon["revision"], "--", *addon["notices"], *sources],
        ]
        for step in steps:
            try:
                subprocess.run(git + step, check=True, timeout=180, capture_output=True,
                               env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
            except (subprocess.SubprocessError, OSError) as error:
                raise ValueError(f"{name} source step '{step[0]}' failed. Check access to {addon['url']} and rerun.") from error
        for source in sources:
            for notice in addon["notices"]:
                shutil.copyfile(checkout / notice, checkout / source / notice)
        for _, source, signature in targets:
            verify_addon(checkout / source, name, signature)
        for target, source, signature in targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(dir=target.parent, prefix=".skill-stage-") as stage:
                staged = Path(stage) / name
                shutil.copytree(checkout / source, staged)
                verify_addon(staged, name, signature)
                if target.exists() or target.is_symlink():
                    verify_addon(target, name, signature)
                else:
                    try:
                        staged.rename(target)
                    except OSError:
                        if not target.exists():
                            raise
                        verify_addon(target, name, signature)


def fetch(source, checksum):
    provider, path = source
    if provider == "local":
        return BOARD_LAUNCHER
    repo, commit = REVISIONS[provider]
    url = f"https://raw.githubusercontent.com/{repo}/{commit}/{path}"
    try:
        with urlopen(url, timeout=15) as response:
            data = response.read()
    except OSError as error:
        raise ValueError(f"Download failed for {repo}/{path}: {error}. Rerun the same installer.") from error
    if digest(data) != checksum:
        raise ValueError(f"Checksum mismatch for {repo}/{path}. Stop and check the source.")
    return data


def publish(root, relative, checksum, data):
    if installed(root, relative, checksum):
        return
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    # A completed temp file is linked into place without replacing another writer's file.
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".skill-install-") as temp:
        temp.write(data)
        temp.flush()
        executable = relative.name in {"board", "board-upstream", "idea-refine.sh", "with_server.py"}
        os.chmod(temp.name, 0o755 if executable else 0o644)
        try:
            os.link(temp.name, target)
        except FileExistsError:
            if not installed(root, relative, checksum):
                raise ValueError(f"Concurrent change at {target}. Rerun the installer.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", choices=("personal", "project"), required=True)
    parser.add_argument("--clients", choices=("auto", "claude", "codex", "both"), default="auto")
    parser.add_argument("--check", action="store_true", help="Verify only. No writes or downloads.")
    parser.add_argument("--with-board", action="store_true", help="Also install the optional board in project mode.")
    parser.add_argument("--with-taste", action="store_true", help="Add Taste 2.5 to this checkout after kickoff.")
    parser.add_argument("--with-impeccable", action="store_true", help="Add the Impeccable 4.8.0 review skill after kickoff.")
    args = parser.parse_args()
    if args.with_board and args.scope != "project":
        raise ValueError("The optional board belongs in an existing project after kickoff.")
    if (args.with_taste or args.with_impeccable) and args.scope != "project":
        raise ValueError("Frontend add-ons use project scope after kickoff.")
    clients = select_clients(args.clients)
    root = install_root(args.scope)
    if args.scope == "personal" and "claude" in clients and os.environ.get("CLAUDE_CONFIG_DIR"):
        if Path(os.environ["CLAUDE_CONFIG_DIR"]).expanduser().resolve() != root / ".claude":
            raise ValueError("Custom Claude config detected. Use project mode at kickoff or review the custom destination.")
    plan = build_plan(clients, args.with_board)
    missing = [row for row in plan if not installed(root, row[0], row[2])]
    addons = {}
    if args.with_taste:
        addons[TASTE_NAME] = []
    if args.with_impeccable:
        addons["impeccable"] = []
    for name, targets in addons.items():
        for client in clients:
            rel = Path(".claude" if client == "claude" else ".agents") / "skills" / name
            target = safe_target(root, rel)
            source, signature = ADDONS[name]["clients"][client]
            if target.exists():
                verify_addon(target, name, signature)
            else:
                targets.append((target, source, signature))
    if args.check and (missing or any(addons.values())):
        paths = [root / row[0] for row in missing]
        paths.extend(target for targets in addons.values() for target, _, _ in targets)
        raise ValueError("Missing files or skill directories:\n" + "\n".join(map(str, paths)))
    # Fetch each missing upstream file once, and validate every byte before publishing any.
    payloads = {}
    for _, source, checksum in missing:
        if source not in payloads:
            payloads[source] = fetch(source, checksum)
    for name, targets in addons.items():
        if targets:
            install_addon(name, targets)
    for relative, source, checksum in missing:
        publish(root, relative, checksum, payloads[source])
    for relative, _, checksum in plan:
        if not installed(root, relative, checksum):
            raise ValueError(f"Incomplete install at {root / relative}. Rerun the installer.")
    names = sorted({p.parent.name for p, _, _ in plan if p.name == "SKILL.md"} | set(addons))
    for name, targets in addons.items():
        label = "Taste" if name == TASTE_NAME else "Impeccable"
        print(f"New {label} client directories: {len(targets)}.")
    print(f"Verified {len(names)} skills per selected client ({', '.join(clients)}). New core/board files: {len(missing)}.")
    print("Skills: " + ", ".join(names))
    for client in clients:
        client_root = root / (".claude" if client == "claude" else ".agents")
        print(f"{client}: {client_root / 'skills'} and {client_root / 'references'}")
    print("Next: confirm discovery in each actual CLI. File verification is only the first check.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        sys.exit(str(error))
```
<!-- INSTALLER END -->
