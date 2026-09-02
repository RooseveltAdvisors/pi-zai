# pi-zai

Pi provider for [Z.AI](https://z.ai)'s general PaaS v4 API.

This package registers `zai-general` and reuses Pi's existing `zai` API key
credential. At startup it fetches Z.AI's current GLM text and vision chat
models from the general PaaS `/models` endpoint.

## Install

Install from npm:

```bash
pi install npm:pi-zai
```

Or add the package to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["npm:pi-zai"]
}
```

The provider uses the API key stored for Pi's built-in `zai` provider. If no
stored credential is available, set `ZAI_API_KEY` in the environment that
launches Pi, then select a model under `zai-general` (for example, `glm-5.1`).

Does **not** use the coding-plan endpoint `https://api.z.ai/api/coding/paas/v4` (that is Pi’s built-in Z.AI provider).
