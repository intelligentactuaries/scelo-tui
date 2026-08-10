# Configuration

## The config file

```text
~/.config/scelo-tui/config.json
```

It holds the selected provider and model, and any API keys you stored with ++k++
in the picker. Nothing else persists between sessions.

Permissions are enforced on **every write**, not only at creation: directory
`0700`, file `0600`.

`XDG_CONFIG_HOME` is honoured if set, so the path follows your XDG layout.
`SCELO_TUI_CONFIG` overrides the whole path when you want the file somewhere
specific.

## Environment

### Choosing a model without the picker

| variable | does |
|---|---|
| `SCELO_TUI_PROVIDER` | the provider to start on |
| `SCELO_TUI_MODEL` | the model id. Default `qwen2.5:7b-instruct-q4_K_M` |

Combined with `--no-intro`, these make a scripted or kiosk start possible:

```bash
SCELO_TUI_MODEL=claude-opus-5 SCELO_TUI_PROVIDER=anthropic scelo book.csv --no-intro
```

### API keys

Used when nothing is stored in the config. **A stored key wins over the
environment.**

| variable | provider |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Google |
| `OPENROUTER_API_KEY` | OpenRouter |

Anthropic additionally picks up an `ant auth login` profile.

### Endpoints

Point a provider somewhere else, at a proxy, a gateway or a self-hosted
endpoint:

| variable | default |
|---|---|
| `SCELO_OLLAMA_URL` | `http://localhost:11434` |
| `ANTHROPIC_BASE_URL` | the Anthropic default |
| `SCELO_OPENAI_URL` | `https://api.openai.com/v1` |
| `SCELO_GOOGLE_URL` | the Gemini default |
| `SCELO_OPENROUTER_URL` | `https://openrouter.ai/api/v1` |

### Behaviour

| variable | does |
|---|---|
| `SCELO_TUI_MOUSE=0` | disable mouse reporting entirely for the session |

### Host detection

Read rather than set by you, but worth knowing since setting them is how you
test a host. See [Whose terminal it is in](../guide/hosts.md).

| variable | means |
|---|---|
| `RSTUDIO` | an RStudio terminal |
| `TERM_PROGRAM=vscode`, `VSCODE_PID`, `VSCODE_CWD` | VS Code or a fork |
| `SCELO_IDE=1` | a Scelo IDE terminal |
| `SCELO_IDE_WORKSPACE` | where that IDE's workspace is, so exports land in it |
| `SCELO_IDE_BIN` | the IDE binary to hand a `.sce` to, when it is not `scelo-ide` on PATH |

## Command line

```bash
scelo                       # start bare
scelo data.csv              # relative paths resolve against YOUR cwd
scelo ~/work/policies.csv
scelo data.csv --no-intro   # skip the picker, use the saved model
```

## What does not persist

The model choice and the keys survive. **Nothing else does**: not the loaded
dataset, not the chat history, not the analysis you switched to.

Exporting the `.sce` at the end of a session is the workaround, and arguably the
feature. See [Limits](limits.md).
