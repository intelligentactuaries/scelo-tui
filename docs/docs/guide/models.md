# Models

| provider | how models are found |
|---|---|
| **Ollama** | local, no key. Discovered from what you have pulled. |
| **Claude Code** | your signed-in `claude` CLI, no key. `default`, `opus`, `sonnet`, `haiku`. |
| **Anthropic** | Claude, via the official SDK. Curated list, Opus 5.5 first. |
| **OpenAI** | discovered from the provider's `/models`. |
| **Google** | same. |
| **OpenRouter** | same, which covers most of everything else. |

The picker **probes rather than guessing**, so "no key stored" does not mean "no
access": Anthropic also picks up an `ant auth login` profile, and every provider
is checked against its actual endpoint before the list is drawn.

## Claude Code: your login, no key

If `claude` is installed and signed in, the picker lists **CLAUDE CODE** and it
just works: nothing to paste, nothing stored. It is the same provider the Scelo
IDE and the swarm gained in 0.2, run the same careful way:

- the prompt goes in on stdin and the reply streams back as it is written
  (`--output-format stream-json`), so a pane never sits silent for twenty
  seconds;
- `--tools ""` and `--strict-mcp-config`: the reply cannot use tools or touch
  your files, and your MCP servers do not load into every question;
- `--no-session-persistence`, and a neutral working directory under the temp
  dir, so your data folder's `CLAUDE.md` or hooks never ride along and no
  sessions pile up under `~/.claude`.

The rows are the CLI's own aliases, so they follow whatever Anthropic ships
under each name. `default` passes no `--model` at all and uses whatever your
`claude` is set to. The picker checks sign-in with `claude auth status`, which
answers locally in about a tenth of a second, rather than spending a model call
every time it opens. Not installed, or signed out, and the row says which.

`SCELO_CLAUDE_BIN` points it at a specific binary; otherwise `PATH` is searched,
then the places installers put it (`~/.local/bin`, `~/.claude/local`, Homebrew,
`~/.bun/bin`, `~/.npm-global/bin`).

## The default, and why

`qwen2.5:7b-instruct-q4_K_M`, running locally through Ollama.

Three chat panes on one screen make **latency matter more than prose**. A 7B
local model answers a terse summarising question fast enough that the screen
keeps up with you; a frontier model over the network does not, and the tasks
here are not hard enough to need one.

The same reasoning is why the Claude path runs at `effort: "low"` with thinking
left on. That is the latency dial, not a cost decision. Pick Opus 5.5 and it
will use Opus 5.5. (Haiku 4.5 does not accept an effort setting, so it is sent
without one.)

## API keys

Press ++k++ on any provider in the picker. The key is:

- **masked as you type** and never printed back
- stored in `~/.config/scelo-tui/config.json`, directory `0700`, file `0600`,
  re-applied on every write
- forgotten with ++x++

Environment variables are used when nothing is stored, and a **stored key wins**
over the environment:

| provider | variable |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google | `GEMINI_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |

See [Configuration](../reference/configuration.md) for the rest of the
environment, including how to point a provider at a different base URL.

## Switching mid-session

`ctrl-o` reopens the picker. Be aware this **re-runs the pipeline**: the app
remounts, so the dataset is read again from the start. A new model reading the
data itself is defensible, but it is worth knowing before you press it on a
120,000-row file.

## When the provider cannot be reached

The pipeline still ingests, profiles and cleans, and still runs an analysis. The
narrative and the bots go inert **and say so**, rather than showing empty boxes
that look like a bug.

Every slash command keeps working, because none of them touch the model. In
practice that means a session with no model at all still gives you the cleaned
data, the analysis menu, the charts, and the full export.

## One interface behind all of them

Everything above `src/agent/llm.ts` imports `complete` and `stream` and has never
known which provider is behind them. Adding Claude did not change that; it
changed the answer from a constant into a runtime selection. Adding the next
provider is an adapter, not a refactor.
