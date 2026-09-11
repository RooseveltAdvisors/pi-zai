# pi-zai

![pi-zai in action](assets/pi-zai-demo.gif)

Pi connects the familiar Pi workflow to Z.AI's general API: install the provider, choose a live GLM model, and start chatting. The terminal capture below shows the provider and model used for the reply.

![Provider and model reply](assets/pi-zai-session.png)

## Example

```json
{
  "model": "zai-general/glm-5.3",
  "apiKey": "$ZAI_API_KEY"
}
```

The provider discovers the current model catalog from Z.AI, so the model ID shown in your session comes directly from the general PaaS API.

Pi provider for [Z.AI](https://z.ai)'s general PaaS v4 API.

This package registers `zai-general`. Configure its API key with `/login
zai-general`; it also reuses Pi's existing `zai` API key credential when
available. At startup and after login it fetches Z.AI's current GLM text and
vision chat models from the general PaaS `/models` endpoint.

## Install

Install from npm:

```bash
pi install https://github.com/RooseveltAdvisors/pi-zai
```


The provider uses the API key stored through `/login zai-general` first, then
the key stored for Pi's built-in `zai` provider. If no stored credential is
available, set `ZAI_API_KEY` in the environment that launches Pi, then select
a model under `zai-general` (for example, `glm-5.1`).

Does **not** use the coding-plan endpoint `https://api.z.ai/api/coding/paas/v4` (that is Pi’s built-in Z.AI provider).
