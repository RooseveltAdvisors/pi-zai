# pi-zai

Pi provider for [Z.AI](https://z.ai) **general** PaaS v4 (resource-bundle API).

This package registers `zai-resource-bundle` and uses `ZAI_API_KEY` for API-key
authentication. At startup it fetches Z.AI's current GLM text and vision chat
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

Set `ZAI_API_KEY` in the environment that launches Pi, then select a model
under `zai-resource-bundle` (for example, `glm-5.1`).

Does **not** use the coding-plan endpoint `https://api.z.ai/api/coding/paas/v4` (that is Pi’s built-in Z.AI provider).
