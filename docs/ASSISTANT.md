# Farm assistant (ASK THE LATTICE, module 22)

Plain-English notes for the owner and for the self-host build (G13).

## What it does

- Answers questions about **this farm's records only**: lots and blocks, harvests (kg), strains, the species
  files, stock, power cuts, climate readings and alarms, what is due today, and (owner only) money owed and sales.
- Opens screens: "show the power cut log", "open the harvest log".
- Saves from a sentence: a harvest, a power cut starting or ending, the generator on or off, a hand climate
  reading, a lot status, stock received or used, a buyer who paid (owner only).
  **Nothing is saved until you press CONFIRM** (or type YES). Each save is one UNDO step and shows in HISTORY
  with the label `ASSISTANT: ...`.
- Every answer ends with the screen it came from, as a button.
- Anything it cannot answer from the records gets a short station-style refusal, then a plain line on what
  you can ask. The refusal lines are written for this app; none come from any film or game.

## Two brains

1. **Rule brain** (always there, no setup). It knows the common sentence shapes listed on ASK > EXAMPLES and the
   codes and names in your records (lot codes, strain codes, buyers, stock items). It answers in well under a second,
   even on a slow phone.
2. **Local model** (optional). A small open model running on your own computer, through
   [Ollama](https://ollama.com) or llama.cpp's `llama-server` (LM Studio and llamafile work too). It handles any
   wording. It is given the same tool list as the rule brain and nothing else, so it can only look things up
   through the app's own tools, and its saves still wait for CONFIRM. If it answers without reading a tool, the
   answer is thrown away. If it is off, slow or unreachable, the rule brain answers and a short note says so.

   ASK > ENGINE settings (kept on each device):
   - ENGINE: OFF / OLLAMA / LLAMA.CPP-LM STUDIO
   - ADDRESS: `http://localhost:11434` (Ollama) or `http://localhost:8080` (llama-server)
   - MODEL NAME: e.g. `qwen2.5:3b`
   - WHO ANSWERS FIRST: rules first (fast, default) or model first
   - TEST CONNECTION, and RUN TEST QUESTIONS (8 questions with known answers on a small made-up farm: the score and
     seconds per answer tell you if a model and a computer are good enough)

## Which model, which computer

These are estimates from public figures, **not measured on the farm PC** (the cloud computer this was built on
cannot download models). Run the TEST QUESTIONS on the real machine to know.

| Model (Ollama name) | Download | Memory in use | Runs well on | Notes |
|---|---|---|---|---|
| `qwen2.5:3b` | 1.9 GB | ~4 GB | Intel N150 mini PC (16 GB), any recent PC | Default pick. Good at choosing tools for its size. Roughly 10-30 s per answer on an N150. |
| `llama3.2:3b` | 2.0 GB | ~4 GB | same | Second choice at 3B, a little weaker at tool arguments. |
| `qwen3:4b` | 2.6 GB | ~5 GB | same | Stronger, slower. The app switches its "thinking" off. |
| `qwen2.5:7b` | 4.7 GB | ~8 GB | 8-core mini PC (Ryzen 7 / Core i5 12th gen or newer) with 32 GB, or any PC with a graphics card | Most reliable. About a minute per answer on an N150: too slow there. |
| `llama3.1:8b` | 4.9 GB | ~8 GB | same as 7B | Good plain English, fine at tools. |

For G13: the default N150 / 16 GB box runs the app, the database and a 3-4B model. A 7-8B model wants a faster
CPU or a graphics card. A Raspberry Pi 5 can run the app and database but is too slow for any of these models.
The rule brain needs no model and runs everywhere.

## Setting up Ollama (on the computer that stays on)

1. Install Ollama from ollama.com.
2. In a terminal: `ollama pull qwen2.5:3b`
3. Let the app's page talk to it: set the setting `OLLAMA_ORIGINS` to the address you open the app from
   (for the public page: `https://josephmclachlan.github.io`), then restart Ollama.
4. In the app: ASK > ENGINE > OLLAMA, address `http://localhost:11434`, model `qwen2.5:3b`, SAVE,
   TEST CONNECTION, RUN TEST QUESTIONS.

**Phones and other computers:** a page opened over `https://` is not allowed to call a plain `http://` address on
another computer, and a phone cannot reach `localhost`. The farm box (docs/SELF-HOST.md) fixes this: it serves the
app and the model under one https address, with the model at the path `/llm`. On a phone, open the app from the
box's address and set ASK > ENGINE > ADDRESS to `/llm`. The public GitHub Pages copy can use the box too, with the
box's full address plus `/llm` (for example `https://farm-box.tail1234.ts.net/llm`); the box allows that one origin.

## Safety rules built in

- No cloud model, no API key, no paid service. The address must be one you type in.
- The model sees only: the rules, today's date, the species names, the tool list, and what the tools return.
- STAFF: money tools are left out of the list the model gets, refused if called anyway, and the Store itself
  returns nothing from the money tables to a staff device or login.
- Saves never happen without CONFIRM, and UNDO reverses them.
- The rule brain and the model answer in English. The ASK screen's labels follow the SPANISH setting.
