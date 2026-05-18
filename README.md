# X Token Opportunity Analyzer

Local web MVP for batch-analyzing crypto project X accounts.

It focuses on:

- whether the project has issued a token
- confirmed or candidate CA
- TGE status and estimated timing
- airdrop, points, and testnet opportunity
- ranked Markdown reports for up to 20 X accounts per batch

## Quick Start

```powershell
Copy-Item .env.example .env
npm.cmd run mock
```

Open:

```text
http://localhost:3000
```

For real analysis, edit `.env`:

```env
XAI_API_KEY=your_xai_key
GPT_API_KEY=your_apikey_fun_key
MOCK_LLM=false
```

Then run:

```powershell
npm.cmd start
```

## TXT Input Format

One project per line:

```text
@project
@project | Project Name | https://project.xyz | Ethereum | notes
```

Lines starting with `#` are ignored.

## API Calls

Fast mode is designed as:

```text
N Grok calls + 1 GPT call
```

For 20 X accounts, that is 21 external API requests. Grok tool invocations may still have separate provider-side cost.
